import type { TranscriptEntry } from "@paperclipai/adapter-utils";

interface OllamaChatChunk {
  message?: { content?: unknown; thinking?: unknown };
  done?: unknown;
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  error?: unknown;
}

/** Converts one raw Ollama /api/chat NDJSON line (relayed verbatim via onLog) into transcript entries. */
export function parseOllamaStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [{ kind: "stdout", ts, text: line }];
  }
  if (!parsed || typeof parsed !== "object") return [{ kind: "stdout", ts, text: line }];
  const chunk = parsed as OllamaChatChunk;

  const entries: TranscriptEntry[] = [];

  if (typeof chunk.message?.thinking === "string" && chunk.message.thinking) {
    entries.push({ kind: "thinking", ts, text: chunk.message.thinking, delta: true });
  }
  if (typeof chunk.message?.content === "string" && chunk.message.content) {
    entries.push({ kind: "assistant", ts, text: chunk.message.content, delta: true });
  }
  if (typeof chunk.error === "string" && chunk.error) {
    entries.push({ kind: "stderr", ts, text: chunk.error });
  }
  if (chunk.done === true) {
    entries.push({
      kind: "result",
      ts,
      text: "",
      inputTokens: typeof chunk.prompt_eval_count === "number" ? chunk.prompt_eval_count : 0,
      outputTokens: typeof chunk.eval_count === "number" ? chunk.eval_count : 0,
      cachedTokens: 0,
      costUsd: 0,
      subtype: typeof chunk.done_reason === "string" ? chunk.done_reason : "stop",
      isError: typeof chunk.error === "string" && chunk.error.length > 0,
      errors: typeof chunk.error === "string" && chunk.error ? [chunk.error] : [],
    });
  }

  return entries.length > 0 ? entries : [{ kind: "stdout", ts, text: line }];
}
