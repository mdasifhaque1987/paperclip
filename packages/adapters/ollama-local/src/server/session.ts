import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaSessionParams {
  messages: OllamaChatMessage[];
  [key: string]: unknown;
}

function isChatMessage(value: unknown): value is OllamaChatMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.role === "system" || v.role === "user" || v.role === "assistant") &&
    typeof v.content === "string"
  );
}

/** Typed deserialize used internally (execute.ts) — narrower than the codec's generic contract. */
export function deserializeSessionParams(raw: unknown): OllamaSessionParams | null {
  if (!raw || typeof raw !== "object") return null;
  const messages = (raw as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return null;
  return { messages: messages.filter(isChatMessage) };
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    return deserializeSessionParams(raw);
  },
  serialize(params) {
    if (!params) return null;
    const messages = (params as Record<string, unknown>).messages;
    if (!Array.isArray(messages)) return null;
    return { messages: messages.filter(isChatMessage) };
  },
  getDisplayId(params) {
    if (!params) return null;
    const messages = (params as Record<string, unknown>).messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;
    return `${messages.length} turn${messages.length === 1 ? "" : "s"}`;
  },
};

/** Keeps only the most recent `max` messages, always preserving a leading system message if present. */
export function truncateHistory(
  messages: OllamaChatMessage[],
  max: number,
): OllamaChatMessage[] {
  if (messages.length <= max) return messages;
  const hasLeadingSystem = messages[0]?.role === "system";
  const head = hasLeadingSystem ? [messages[0]] : [];
  const rest = hasLeadingSystem ? messages.slice(1) : messages.slice();
  const keep = Math.max(0, max - head.length);
  return [...head, ...rest.slice(rest.length - keep)];
}
