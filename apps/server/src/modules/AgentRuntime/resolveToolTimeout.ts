import type { LobeToolManifest } from '@lobechat/context-engine';

import { DEFAULT_AGENT_STEP_DEADLINE_MS } from './stepDeadline';

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
 * asks for. A tool must leave enough room for the containing step to persist
 * its terminal state and release execution resources.
 */
export const MAX_TIMEOUT_MS = DEFAULT_AGENT_STEP_DEADLINE_MS;

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
  /** Absolute deadline of the containing step. */
  deadlineAt?: number;
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
 * Configuration is clamped to `[MIN_TIMEOUT_MS, MAX_TIMEOUT_MS]`, then reduced
 * to the containing step's remaining budget when a deadline is present. The
 * client is a *suggester*; this function is the sole *arbiter*.
 */
export const resolveToolTimeoutMs = ({
  apiName,
  args,
  deadlineAt,
  manifest,
}: ResolveToolTimeoutInput): number => {
  const argTimeout = readPositiveNumber(args?.timeout);
  const manifestApi = manifest?.api?.find((item) => item.name === apiName);
  const manifestDefault = readPositiveNumber(manifestApi?.defaultTimeoutMs);
  const configuredTimeout = clamp(argTimeout ?? manifestDefault ?? GLOBAL_DEFAULT_TIMEOUT_MS);

  if (deadlineAt === undefined) return configuredTimeout;

  const remainingStepBudget = Math.max(1, Math.trunc(deadlineAt - Date.now()));
  return Math.min(configuredTimeout, remainingStepBudget);
};
