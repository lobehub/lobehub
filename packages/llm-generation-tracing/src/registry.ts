import type { ScenarioDefinition } from './types';

/**
 * Default trigger → scenario mapping. Several triggers (notably `agent_signal`)
 * fan out into multiple scenarios; callers in those cases pass an explicit
 * `metadata.scenario` override, which `resolveScenario` honours over this table.
 */
export const TRACING_SCENARIO_REGISTRY: Record<string, ScenarioDefinition> = {
  agent_signal: { promptVersion: 'v1.0', scenario: 'agent_signal' },
  memory: { promptVersion: 'v1.0', scenario: 'memory_extract' },
  signup_email_llm_review: { promptVersion: 'v1.0', scenario: 'signup_email_review' },
  topic: { promptVersion: 'v1.0', scenario: 'topic_title' },
};

export const UNKNOWN_SCENARIO: ScenarioDefinition = {
  promptVersion: 'v0',
  scenario: 'unknown',
};

export interface ResolveScenarioInput {
  /** Override prompt version when overriding scenario. */
  promptVersion?: string;
  /** Override scenario name (e.g. `signal_skill_intent`); takes precedence over registry. */
  scenario?: string;
  /** RequestTrigger value (string form). */
  trigger?: string;
}

/**
 * Pick the {scenario, promptVersion} for a given call.
 *
 * Resolution order:
 *   1. explicit override on `input.scenario` (+ optional `promptVersion`)
 *   2. registry lookup by `input.trigger`
 *   3. `UNKNOWN_SCENARIO` sentinel
 */
export const resolveScenario = (input: ResolveScenarioInput): ScenarioDefinition => {
  if (input.scenario) {
    return { promptVersion: input.promptVersion ?? 'v1.0', scenario: input.scenario };
  }
  if (input.trigger && TRACING_SCENARIO_REGISTRY[input.trigger]) {
    return TRACING_SCENARIO_REGISTRY[input.trigger];
  }
  return UNKNOWN_SCENARIO;
};
