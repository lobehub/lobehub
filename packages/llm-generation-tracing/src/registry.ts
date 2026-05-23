import { TRACING_SCENARIOS, type TracingScenario } from '@lobechat/const';

import type { ScenarioDefinition } from './types';

/**
 * Stable `trigger → scenario` mapping. Maps a `RequestTrigger` value to the
 * default scenario name used for tracing.
 *
 * Triggers that fan out into multiple scenarios (e.g. `agent_signal` →
 * `signal_skill_intent` / `signal_feedback_satisfaction` / ...) deliberately
 * have no default entry here; those callers pass an explicit
 * `metadata.scenario` instead.
 *
 * **Note on prompt versions**: version intentionally lives next to the prompt
 * it describes (see `tracing.ts` files / `*_PROMPT_VERSION` constants near the
 * `generateObject` call site). When the prompt or schema changes, bump that
 * local constant — keeping the version next to the thing it versions avoids
 * the drift you'd get from a central table that nobody remembers to update.
 *
 * For the full directory of scenario *names*, see `@lobechat/const`
 * `TRACING_SCENARIOS`.
 */
export const TRACING_SCENARIO_REGISTRY: Record<string, TracingScenario> = {
  agent_signal: TRACING_SCENARIOS.AgentSignal,
  memory: TRACING_SCENARIOS.MemoryExtract,
  signup_email_llm_review: TRACING_SCENARIOS.SignupEmailReview,
  topic: TRACING_SCENARIOS.TopicTitle,
};

export const UNKNOWN_SCENARIO = TRACING_SCENARIOS.Unknown;
export const UNKNOWN_PROMPT_VERSION = 'v0';

export interface ResolveScenarioInput {
  /**
   * Prompt version supplied by the caller. Conventionally a `v<major>.<minor>`
   * constant declared next to the prompt definition. Missing values resolve to
   * `UNKNOWN_PROMPT_VERSION` so tracing still records the row.
   */
  promptVersion?: string;
  /** Override scenario name (e.g. `signal_skill_intent`); takes precedence over registry. */
  scenario?: string;
  /** RequestTrigger value (string form). */
  trigger?: string;
}

/**
 * Pick the `{ scenario, promptVersion }` for a tracing record.
 *
 * Resolution order:
 *   1. `input.scenario` if provided
 *   2. registry lookup by `input.trigger`
 *   3. `UNKNOWN_SCENARIO` sentinel
 *
 * `promptVersion` is always passed through from the caller (or
 * `UNKNOWN_PROMPT_VERSION` if absent). The registry never assigns versions —
 * they live with the prompt.
 */
export const resolveScenario = (input: ResolveScenarioInput): ScenarioDefinition => {
  const scenario =
    input.scenario ??
    (input.trigger ? TRACING_SCENARIO_REGISTRY[input.trigger] : undefined) ??
    UNKNOWN_SCENARIO;
  return {
    promptVersion: input.promptVersion ?? UNKNOWN_PROMPT_VERSION,
    scenario,
  };
};
