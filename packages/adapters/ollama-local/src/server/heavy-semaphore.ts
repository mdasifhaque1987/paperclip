// Enforces MAX_HEAVY_LLM_WORKERS on this VM: this CPU-only, no-GPU host must
// never run two heavy-tier local model inferences at once (see
// ai-company/benchmarks/README.md ground rules and the swap-pressure finding
// in ai-company/docs/BENCHMARK_SUMMARY.md section 8). Paperclip's own budget
// system has no concept of "concurrent local inference processes", so this
// adapter enforces the limit itself with an in-process semaphore. This is
// process-local by design — Paperclip's server runs as a single Node
// process, matching how the limit was enforced manually throughout the
// benchmark (one `ollama` inference at a time, explicit `ollama stop`
// between switches).

const DEFAULT_MAX_HEAVY_WORKERS = 1;

// Tags treated as "heavy" even if the agent doesn't set config.isHeavy.
// Keep in sync with docs/BENCHMARK_SUMMARY.md's heavy-escalation tier.
const HEAVY_MODEL_TAGS = new Set(["gemma3:27b", "qwen3:32b"]);

export function isHeavyModel(model: string, configuredHeavy: boolean | undefined): boolean {
  if (configuredHeavy === true) return true;
  if (configuredHeavy === false) return false;
  return HEAVY_MODEL_TAGS.has(model.trim());
}

function readMaxHeavyWorkers(): number {
  const raw = process.env.MAX_HEAVY_LLM_WORKERS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_HEAVY_WORKERS;
}

let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  const limit = readMaxHeavyWorkers();
  if (active < limit) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

/** Runs `fn` under the heavy-worker semaphore if `heavy` is true, otherwise runs it immediately. */
export async function withHeavySlot<T>(heavy: boolean, fn: () => Promise<T>): Promise<T> {
  if (!heavy) return fn();
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test/diagnostic helper — current queue depth for a testEnvironment check. */
export function heavySemaphoreStatus(): { active: number; waiting: number; limit: number } {
  return { active, waiting: waiters.length, limit: readMaxHeavyWorkers() };
}
