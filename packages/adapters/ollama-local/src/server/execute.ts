import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asNumber,
  asString,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  joinPromptSections,
  parseObject,
  renderPaperclipWakePrompt,
  renderTemplate,
  selectInitialCommunicationGuidance,
  selectPaperclipTaskMarkdown,
} from "@paperclipai/adapter-utils/server-utils";

import { isHeavyModel, withHeavySlot } from "./heavy-semaphore.js";
import { parseOllamaChatOutput } from "./parse.js";
import {
  deserializeSessionParams,
  sessionCodec,
  truncateHistory,
  type OllamaChatMessage,
  type OllamaSessionParams,
} from "./session.js";

const DEFAULT_HOST = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_MAX_HISTORY = 20;

const CAPABILITY_BOUNDARY_NOTE =
  "You are a text-only local assistant running via Ollama. You cannot execute " +
  "commands, edit files, browse, or take any action outside this reply — you " +
  "can only respond with text. A human or a separate tool-using agent is " +
  "responsible for acting on what you write. Do not claim to have taken any " +
  "action; only describe what you found or what you'd write/do.";

function buildUserMessage(ctx: AdapterExecutionContext, hasSession: boolean): string {
  const context = ctx.context ?? {};
  const config = ctx.config ?? {};
  const templateData = {
    agentId: ctx.agent.id,
    companyId: ctx.agent.companyId,
    runId: ctx.runId,
    company: { id: ctx.agent.companyId },
    agent: ctx.agent,
    run: { id: ctx.runId, source: "on_demand" },
    context,
  };

  const taskContextNote = selectPaperclipTaskMarkdown(context, { resumedSession: hasSession });
  const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, {
    resumedSession: hasSession,
    conversationMode: context.conversationMode === true,
    suppressIssueDescription: taskContextNote.length > 0,
  });
  const communicationGuidance = selectInitialCommunicationGuidance(context, {
    resumedSession: hasSession,
  });

  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const renderedPrompt =
    hasSession && wakePrompt.length > 0 ? "" : renderTemplate(promptTemplate, templateData);

  const message = joinPromptSections([
    communicationGuidance,
    wakePrompt,
    taskContextNote,
    renderedPrompt,
  ]);

  return message.trim().length > 0
    ? message
    : "No task context was provided for this run. Say so briefly and stop.";
}

async function readOllamaStream(
  response: Response,
  onLog: AdapterExecutionContext["onLog"],
): Promise<string> {
  if (!response.body) return "";
  let raw = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      raw += `${line}\n`;
      await onLog("stdout", `${line}\n`);
    }
  }
  if (buffer.trim()) {
    raw += `${buffer}\n`;
    await onLog("stdout", `${buffer}\n`);
  }
  return raw;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = parseObject(ctx.config);
  const host = asString(config.host, DEFAULT_HOST).replace(/\/+$/, "");
  const model = asString(config.model, "").trim();
  const think = asBoolean(config.think, true);
  const temperature = asNumber(config.temperature, 0.7);
  const numCtx = asNumber(config.numCtx, 4096);
  const timeoutSec = asNumber(config.timeoutSec, DEFAULT_TIMEOUT_SEC);
  const maxHistoryMessages = asNumber(config.maxHistoryMessages, DEFAULT_MAX_HISTORY);
  const configuredHeavy =
    typeof config.isHeavy === "boolean" ? (config.isHeavy as boolean) : undefined;

  if (!model) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage:
        "ollama_local: no model configured. Set adapterConfig.model to a pulled Ollama tag " +
        "(e.g. qwen3:8b) — see this adapter's agentConfigurationDoc for the recommended tiers.",
    };
  }

  const existing = ctx.runtime.sessionParams
    ? deserializeSessionParams(ctx.runtime.sessionParams)
    : null;
  const priorMessages: OllamaChatMessage[] = existing?.messages ?? [];
  const hasSession = priorMessages.length > 0;

  const userMessage = buildUserMessage(ctx, hasSession);
  const messages: OllamaChatMessage[] = hasSession
    ? [...priorMessages, { role: "user", content: userMessage }]
    : [
        { role: "system", content: CAPABILITY_BOUNDARY_NOTE },
        { role: "user", content: userMessage },
      ];
  const outgoingMessages = truncateHistory(messages, maxHistoryMessages);

  const heavy = isHeavyModel(model, configuredHeavy);

  if (ctx.onMeta) {
    await ctx.onMeta({
      adapterType: "ollama_local",
      command: "fetch",
      commandArgs: [`${host}/api/chat`, model],
      commandNotes: heavy
        ? ["gated by MAX_HEAVY_LLM_WORKERS heavy-model semaphore"]
        : undefined,
      prompt: userMessage,
      promptMetrics: { promptChars: userMessage.length, historyMessages: outgoingMessages.length },
      context: ctx.context,
    });
  }

  await ctx.onCancellationReady?.();
  ctx.onDispatch?.();

  const abortSignals: AbortSignal[] = [];
  if (timeoutSec > 0) abortSignals.push(AbortSignal.timeout(timeoutSec * 1000));
  if (ctx.signal) abortSignals.push(ctx.signal);
  const signal = abortSignals.length > 0 ? AbortSignal.any(abortSignals) : undefined;

  try {
    const rawOutput = await withHeavySlot(heavy, async () => {
      const response = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          model,
          messages: outgoingMessages,
          stream: true,
          think,
          options: { temperature, num_ctx: numCtx },
        }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
          `Ollama returned HTTP ${response.status} for model "${model}": ${bodyText.slice(0, 500)}`,
        );
      }
      return readOllamaStream(response, ctx.onLog);
    });

    const parsed = parseOllamaChatOutput(rawOutput);
    const resultMessages: OllamaChatMessage[] = parsed.summary
      ? [...outgoingMessages, { role: "assistant", content: parsed.summary }]
      : outgoingMessages;
    const sessionParams: OllamaSessionParams = {
      messages: truncateHistory(resultMessages, maxHistoryMessages),
    };

    if (!parsed.summary) {
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: "ollama_local: empty response from Ollama (see log for raw stream).",
        provider: "ollama",
        model: parsed.model ?? model,
        sessionParams: sessionCodec.serialize(sessionParams),
        sessionDisplayId: sessionCodec.getDisplayId?.(sessionParams) ?? null,
      };
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: parsed.usage
        ? { inputTokens: parsed.usage.inputTokens, outputTokens: parsed.usage.outputTokens }
        : undefined,
      usageBasis: "per_run",
      provider: "ollama",
      model: parsed.model ?? model,
      costUsd: 0,
      summary: parsed.summary,
      resultJson: parsed.thinking ? { thinking: parsed.thinking } : null,
      sessionParams: sessionCodec.serialize(sessionParams),
      sessionDisplayId: sessionCodec.getDisplayId?.(sessionParams) ?? null,
    };
  } catch (error) {
    const aborted = ctx.signal?.aborted === true;
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = !aborted && /timeout|aborted/i.test(message);
    return {
      exitCode: null,
      signal: aborted ? "cancelled" : null,
      timedOut,
      errorMessage: aborted
        ? "Cancelled by operator."
        : `ollama_local: ${message}. Is the Ollama server running at ${host}? ` +
          `(\`systemctl status ollama\` / \`ollama list\`)`,
      provider: "ollama",
      model,
    };
  }
}
