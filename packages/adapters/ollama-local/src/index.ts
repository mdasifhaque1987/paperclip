// Shared metadata for the ollama_local adapter. Imported by server, UI, and
// CLI consumers — keep this file dependency-free (no Node APIs, no React).

export const type = "ollama_local";
export const label = "Ollama (Local)";

// Model tags verified against this VM's benchmark sweep
// (ai-company/docs/BENCHMARK_SUMMARY.md, ai-company/docs/MODEL_STRATEGY.md).
// Labels encode the recommended org-chart role so the agent creation form
// reads as a role picker, not a raw model list.
export const models: { id: string; label: string }[] = [
  {
    id: "qwen3:4b-instruct-2507-q4_K_M",
    label: "qwen3:4b-instruct-2507 — Routine/Utility tier",
  },
  {
    id: "qwen3:8b",
    label: "qwen3:8b — Specialist/Management + Code Review tier",
  },
  {
    id: "qwen3:14b",
    label: "qwen3:14b — Senior Engineer tier (coding/debugging only — do not use for review)",
  },
  {
    id: "gemma3:27b",
    label: "gemma3:27b — Heavy Escalation tier",
  },
  {
    id: "qwen3:32b",
    label: "qwen3:32b — Heavy Escalation tier (Qwen-family alternative)",
  },
];

export const agentConfigurationDoc = `# ollama_local agent configuration

Adapter: ollama_local

This adapter calls a locally running Ollama server (default
http://127.0.0.1:11434) over plain HTTP — it does not spawn a CLI process and
the model has no tool-use / file-system / shell access of its own. It answers
in a single request/response turn per wake, using conversation history
carried in the session for context.

Use when:
- The task is a bounded text-generation call: classification/routing,
  drafting, summarizing, writing a small code snippet, or reviewing a diff
  and listing issues in prose.
- You want zero per-token cost and no data leaving this machine.
- The task does not require the agent to browse, execute commands, edit
  files in a repo, or take multi-step autonomous action.

Don't use when:
- The task needs an agent that can actually run commands, edit a
  repository, or use tools across multiple steps — use claude_local or
  codex_local instead. This adapter can only produce text; it cannot act on
  its own output.
- The task requires large context beyond what fits in this VM's RAM budget
  at the chosen model's tier (see model tiers below).
- Code review reliability matters and the configured model is
  \`qwen3:14b\` — that specific checkpoint fabricates plausible-looking but
  fake issues on review prompts in this project's benchmark (reproducible
  across every comparison run). Use \`qwen3:8b\`, \`qwen3:32b\`, or
  \`gemma3:27b\` for review instead.

Model tiers (see ai-company/docs/BENCHMARK_SUMMARY.md for full benchmark
data backing these choices):
- Routine/Utility (~4B): \`qwen3:4b-instruct-2507-q4_K_M\` — fast, no
  thinking-mode overhead, good format compliance.
- Specialist/Management (~7-9B): \`qwen3:8b\` — reliable structured JSON,
  also the recommended reviewer model (unlike qwen3:14b).
- Senior Engineer (~14B): \`qwen3:14b\` — strong on coding/debugging tasks
  with a single correct answer; NOT for code review (see above).
- Heavy Escalation (~27-32B): \`gemma3:27b\` (preferred: faster, lighter,
  no thinking-mode management) or \`qwen3:32b\` (Qwen-family alternative).
  Both are gated by a process-wide semaphore (default max 1 concurrent
  request) so this single-VM, no-GPU host is never asked to run two heavy
  models at once.

Core fields:
- model (string, required): one of the Ollama tags listed above. Must
  already be pulled on the host (\`ollama list\`) — this adapter does not
  pull models on demand.
- host (string, optional): Ollama server base URL. Default
  \`http://127.0.0.1:11434\`.
- think (boolean, optional): request thinking-mode reasoning where the
  model supports it. Default true for qwen3 tags, ignored by non-thinking
  models (gemma3, llama3.1). Turn off for latency-sensitive routing calls.
- temperature (number, optional): sampling temperature. Default 0.7.
- numCtx (number, optional): context window size in tokens passed as
  Ollama's \`num_ctx\` option. Default 4096.
- timeoutSec (number, optional): per-request timeout. Default 600 (heavy
  tier models can take minutes on CPU-only inference). 0 = no timeout.
- maxHistoryMessages (number, optional): how many prior turns to keep in
  the session before truncating the oldest. Default 20.
- isHeavy (boolean, optional): force-treat this agent's model as
  semaphore-gated "heavy" regardless of the \`model\` field, for custom or
  future large tags. gemma3:27b and qwen3:32b are already treated as heavy
  by default.
`;
