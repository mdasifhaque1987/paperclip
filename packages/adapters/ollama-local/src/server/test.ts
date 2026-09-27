import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentCheck,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

import { heavySemaphoreStatus, isHeavyModel } from "./heavy-semaphore.js";

const DEFAULT_HOST = "http://127.0.0.1:11434";

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = parseObject(ctx.config);
  const host = asString(config.host, DEFAULT_HOST).replace(/\/+$/, "");
  const model = asString(config.model, "").trim();
  const checks: AdapterEnvironmentCheck[] = [];

  let tags: string[] = [];
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      checks.push({
        code: "ollama_server_unreachable",
        level: "error",
        message: `Ollama server at ${host} responded with HTTP ${response.status}.`,
        hint: "Check that the ollama systemd service is running: `systemctl status ollama`.",
      });
    } else {
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      tags = (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
      checks.push({
        code: "ollama_server_reachable",
        level: "info",
        message: `Ollama server reachable at ${host} (${tags.length} model${tags.length === 1 ? "" : "s"} pulled).`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      code: "ollama_server_unreachable",
      level: "error",
      message: `Could not reach Ollama server at ${host}: ${message}`,
      hint: "Ollama binds to localhost only by default — confirm this agent runs on the same host, and that the service is started.",
    });
  }

  if (!model) {
    checks.push({
      code: "ollama_model_missing_config",
      level: "error",
      message: "No model configured for this agent.",
      hint: "Set adapterConfig.model to a pulled Ollama tag, e.g. qwen3:8b.",
    });
  } else if (tags.length > 0 && !tags.includes(model)) {
    checks.push({
      code: "ollama_model_not_pulled",
      level: "warn",
      message: `Configured model "${model}" was not found in \`ollama list\` on this host.`,
      detail: `Locally available: ${tags.join(", ") || "(none)"}`,
      hint: `Pull it first: \`ollama pull ${model}\`. This adapter does not pull models on demand.`,
    });
  } else if (tags.length > 0) {
    checks.push({
      code: "ollama_model_available",
      level: "info",
      message: `Configured model "${model}" is pulled and available.`,
    });
  }

  if (model) {
    const heavy = isHeavyModel(model, typeof config.isHeavy === "boolean" ? (config.isHeavy as boolean) : undefined);
    const status = heavySemaphoreStatus();
    checks.push({
      code: "ollama_heavy_semaphore",
      level: "info",
      message: heavy
        ? `Treated as a heavy-tier model — gated by the MAX_HEAVY_LLM_WORKERS semaphore (limit ${status.limit}, currently ${status.active} active, ${status.waiting} waiting).`
        : "Not treated as a heavy-tier model — runs without the heavy-worker semaphore.",
    });
  }

  const status: AdapterEnvironmentTestResult["status"] = checks.some((c) => c.level === "error")
    ? "fail"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "pass";

  return {
    adapterType: "ollama_local",
    status,
    checks,
    testedAt: new Date().toISOString(),
  };
}
