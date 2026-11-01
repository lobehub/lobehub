import { type LobeToolManifest } from '@lobechat/context-engine';

/**
 * Global fallback when neither the LLM nor the tool manifest specifies a
 * timeout. Chosen to fit the common case (most tools complete in seconds)
 * while leaving room for short-running shell commands.
 */
export const GLOBAL_DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Lower bound — anything shorter than this is almost certainly a misconfig.
 */
export const MIN_TIMEOUT_MS = 1_000;

/**
 * Hard ceiling enforced server-side regardless of what the LLM or manifest
 * asks for. Matches the cloud agent function window (800s) so a single
 * client-tool dispatch never outlives its containing run.
 */
export const MAX_TIMEOUT_MS = 800_000;

const clamp = (value: number): number =>
  Math.min(Math.max(Math.trunc(value), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);

const readPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
};

export interface ResolveToolTimeoutInput {
  apiName: string;
  /**
   * Tool arguments parsed from the LLM `tool_call.arguments` JSON. The
   * LLM-supplied `timeout` (in milliseconds, per the manifest contract)
   * takes top priority when present.
   */
  args?: Record<string, unknown> | null;
  /** Manifest for the tool being dispatched, looked up by identifier. */
  manifest?: LobeToolManifest;
}

/**
 * Decide the per-call execution timeout for a client-side tool dispatch.
 *
 * Priority (highest first):
 *   1. `args.timeout` — LLM-supplied per-call value (ms)
 *   2. `manifest.api[apiName].defaultTimeoutMs` — tool-author default (ms)
 *   3. `GLOBAL_DEFAULT_TIMEOUT_MS` (120_000)
 *
 * The result is always clamped to `[MIN_TIMEOUT_MS, MAX_TIMEOUT_MS]`. The
 * client is a *suggester*; this function is the sole *arbiter*.
 */
export const resolveToolTimeoutMs = ({
  apiName,
  args,
  manifest,
}: ResolveToolTimeoutInput): number => {
  const argTimeout = readPositiveNumber(args?.timeout);
  if (argTimeout !== undefined) return clamp(argTimeout);

  const manifestApi = manifest?.api?.find((a) => a.name === apiName);
  const manifestDefault = readPositiveNumber(manifestApi?.defaultTimeoutMs);
  if (manifestDefault !== undefined) return clamp(manifestDefault);

  return clamp(GLOBAL_DEFAULT_TIMEOUT_MS);
};
