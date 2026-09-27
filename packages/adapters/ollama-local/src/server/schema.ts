import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";

// Declarative config form — the shared `SchemaConfigFields` UI component
// renders these automatically, so this adapter ships no bespoke React form.
// The model picker itself is handled by Paperclip's generic model select
// (populated from this package's root `models` export) and is not repeated
// here.
export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "host",
        label: "Ollama host",
        type: "text",
        default: "http://127.0.0.1:11434",
        hint: "Base URL of the local Ollama server. Ollama binds to localhost only by default.",
        group: "configuration",
      },
      {
        key: "think",
        label: "Thinking mode",
        type: "toggle",
        default: true,
        hint: "Requests Qwen3 thinking-mode reasoning. Ignored by non-thinking models (gemma3, llama3.1). Turn off for latency-sensitive routing/classification roles.",
        group: "configuration",
      },
      {
        key: "temperature",
        label: "Temperature",
        type: "number",
        default: 0.7,
        hint: "Sampling temperature passed as Ollama's options.temperature.",
        group: "advanced",
      },
      {
        key: "numCtx",
        label: "Context window (tokens)",
        type: "number",
        default: 16384,
        hint: "Passed as Ollama's options.num_ctx. Paperclip's own execution-contract prompt plus any injected reference skills can exceed 4k tokens before the actual task content, so the default is set well above that floor. Larger windows use more RAM per loaded model.",
        group: "advanced",
      },
      {
        key: "timeoutSec",
        label: "Timeout (seconds)",
        type: "number",
        default: 600,
        hint: "Per-request timeout. Heavy-tier models can take several minutes on CPU-only inference. 0 = no timeout.",
        group: "runPolicy",
      },
      {
        key: "maxHistoryMessages",
        label: "Max history messages",
        type: "number",
        default: 20,
        hint: "How many prior conversation turns to resend each call before truncating the oldest (a leading system message is always kept).",
        group: "runPolicy",
      },
      {
        key: "skillKeys",
        label: "Reference skills",
        type: "textarea",
        default: "",
        hint: "Comma or newline separated skills-catalog keys (e.g. quality/qa-acceptance) whose SKILL.md content is folded into this agent's system prompt as reference knowledge — not executed as tools, since this adapter has no tool-use loop. See this adapter's agentConfigurationDoc.",
        group: "configuration",
      },
      {
        key: "isHeavy",
        label: "Force heavy-tier semaphore",
        type: "toggle",
        default: false,
        hint: "gemma3:27b and qwen3:32b are already gated by the MAX_HEAVY_LLM_WORKERS semaphore automatically. Enable this for any other large custom model tag that should share the same one-at-a-time limit.",
        group: "advanced",
      },
    ],
  };
}
