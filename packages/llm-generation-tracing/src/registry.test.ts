import { describe, expect, it } from 'vitest';

import {
  resolveScenario,
  TRACING_SCENARIO_REGISTRY,
  UNKNOWN_PROMPT_VERSION,
  UNKNOWN_SCENARIO,
} from './registry';

describe('TRACING_SCENARIO_REGISTRY', () => {
  it('maps known triggers to scenario names (no versions)', () => {
    expect(TRACING_SCENARIO_REGISTRY.topic).toBe('topic_title');
    expect(TRACING_SCENARIO_REGISTRY.memory).toBe('memory_extract');
  });
});

describe('resolveScenario', () => {
  it('looks the scenario up by trigger and uses the caller-supplied promptVersion', () => {
    expect(resolveScenario({ promptVersion: 'v3.1', trigger: 'topic' })).toEqual({
      promptVersion: 'v3.1',
      scenario: 'topic_title',
    });
  });

  it('honours an explicit scenario override even when trigger has a registry mapping', () => {
    expect(
      resolveScenario({
        promptVersion: 'v2.1',
        scenario: 'signal_skill_intent',
        trigger: 'agent_signal',
      }),
    ).toEqual({ promptVersion: 'v2.1', scenario: 'signal_skill_intent' });
  });

  it('falls back to UNKNOWN_PROMPT_VERSION when no version is provided', () => {
    expect(resolveScenario({ scenario: 'custom_thing' })).toEqual({
      promptVersion: UNKNOWN_PROMPT_VERSION,
      scenario: 'custom_thing',
    });
  });

  it('falls back to the unknown scenario sentinel when neither matches', () => {
    expect(resolveScenario({ trigger: 'does_not_exist' })).toEqual({
      promptVersion: UNKNOWN_PROMPT_VERSION,
      scenario: UNKNOWN_SCENARIO,
    });
    expect(resolveScenario({})).toEqual({
      promptVersion: UNKNOWN_PROMPT_VERSION,
      scenario: UNKNOWN_SCENARIO,
    });
  });
});
