// Parses Ollama's native streaming NDJSON chat format. execute.ts relays each
// raw line from Ollama's HTTP response body through onLog("stdout", line) as
// it arrives, so the UI/CLI transcript parsers can consume the same wire
// format live. This file re-parses the accumulated raw text after the run
// completes, as the single source of truth for the returned
// AdapterExecutionResult fields.
//
// Treat this output as untrusted per the adapter security contract: it is
// LLM-generated text that may echo back anything from the prompt (including
// injected content from task descriptions). Never eval() or execute it here
// — only extract strings/numbers defensively.

export interface ParsedOllamaChatOutput {
  summary: string;
  thinking: string;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  doneReason: string | null;
}

interface OllamaChatChunk {
  model?: unknown;
  message?: { role?: unknown; content?: unknown; thinking?: unknown };
  done?: unknown;
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  error?: unknown;
}

function asRecord(value: unknown): OllamaChatChunk | null {
  return value && typeof value === "object" ? (value as OllamaChatChunk) : null;
}

/** Parses the raw NDJSON text captured from an Ollama /api/chat streaming response. */
export function parseOllamaChatOutput(rawOutput: string): ParsedOllamaChatOutput {
  let summary = "";
  let thinking = "";
  let model: string | null = null;
  let usage: ParsedOllamaChatOutput["usage"] = null;
  let doneReason: string | null = null;
  let firstError: string | null = null;

  for (const line of rawOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // Ignore non-JSON noise lines defensively.
    }
    const chunk = asRecord(parsed);
    if (!chunk) continue;

    if (typeof chunk.error === "string" && !firstError) firstError = chunk.error;
    if (typeof chunk.model === "string" && chunk.model) model = chunk.model;
    if (chunk.message && typeof chunk.message.content === "string") {
      summary += chunk.message.content;
    }
    if (chunk.message && typeof chunk.message.thinking === "string") {
      thinking += chunk.message.thinking;
    }
    if (chunk.done === true) {
      const inputTokens =
        typeof chunk.prompt_eval_count === "number" ? chunk.prompt_eval_count : 0;
      const outputTokens = typeof chunk.eval_count === "number" ? chunk.eval_count : 0;
      usage = { inputTokens, outputTokens };
      doneReason = typeof chunk.done_reason === "string" ? chunk.done_reason : null;
    }
  }

  if (firstError && !summary) {
    // Surface Ollama's own error text (e.g. "model not found") as the summary
    // so it's visible in the run viewer even though execute.ts also sets
    // errorMessage on the returned result.
    summary = `[ollama error] ${firstError}`;
  }

  return { summary: summary.trim(), thinking: thinking.trim(), model, usage, doneReason };
}

/**
 * Ollama's chat API is stateless per request — we resend the full message
 * history every call (see server/execute.ts session codec), so there is no
 * server-side session to expire. This always returns false; it exists to
 * satisfy the adapter contract's "unknown session detection" convention and
 * to give retry logic in execute.ts an explicit, documented no-op to call
 * rather than silently having none.
 */
export function isOllamaUnknownSessionError(_output: string): boolean {
  return false;
}
