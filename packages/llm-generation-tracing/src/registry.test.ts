import { describe, expect, it } from 'vitest';

import { resolveScenario, TRACING_SCENARIO_REGISTRY, UNKNOWN_SCENARIO } from './registry';

describe('resolveScenario', () => {
  it('returns the registry entry when only trigger is provided', () => {
    expect(resolveScenario({ trigger: 'topic' })).toEqual(TRACING_SCENARIO_REGISTRY.topic);
  });

  it('honors explicit scenario override even when trigger has a registry mapping', () => {
    expect(
      resolveScenario({
        promptVersion: 'v2.1',
        scenario: 'signal_skill_intent',
        trigger: 'agent_signal',
      }),
    ).toEqual({ promptVersion: 'v2.1', scenario: 'signal_skill_intent' });
  });

  it('defaults overridden promptVersion to v1.0 when omitted', () => {
    expect(resolveScenario({ scenario: 'custom_thing' })).toEqual({
      promptVersion: 'v1.0',
      scenario: 'custom_thing',
    });
  });

  it('falls back to the unknown sentinel when neither matches', () => {
    expect(resolveScenario({ trigger: 'does_not_exist' })).toEqual(UNKNOWN_SCENARIO);
    expect(resolveScenario({})).toEqual(UNKNOWN_SCENARIO);
  });
});
