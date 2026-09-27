import pc from "picocolors";

interface OllamaChatChunk {
  message?: { content?: unknown; thinking?: unknown };
  done?: unknown;
  done_reason?: unknown;
  eval_count?: unknown;
  error?: unknown;
}

export function printOllamaStreamEvent(raw: string, debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: OllamaChatChunk | null = null;
  try {
    parsed = JSON.parse(line) as OllamaChatChunk;
  } catch {
    if (debug) console.log(pc.gray(line));
    return;
  }

  if (typeof parsed.message?.thinking === "string" && parsed.message.thinking) {
    process.stdout.write(pc.gray(parsed.message.thinking));
  }
  if (typeof parsed.message?.content === "string" && parsed.message.content) {
    process.stdout.write(pc.green(parsed.message.content));
  }
  if (typeof parsed.error === "string" && parsed.error) {
    console.log(pc.red(`\nerror: ${parsed.error}`));
  }
  if (parsed.done === true) {
    const tokens = typeof parsed.eval_count === "number" ? parsed.eval_count : 0;
    console.log(pc.dim(`\n[done: ${String(parsed.done_reason ?? "stop")}, ${tokens} tokens generated]`));
  }
}
