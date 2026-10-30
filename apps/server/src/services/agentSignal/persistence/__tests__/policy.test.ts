import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it } from 'vitest';

import {
  AGENT_SIGNAL_SOURCE_PERSISTENCE,
  resolveSignalPersistence,
  shouldPersistSignal,
} from '../policy';

describe('signal persistence policy', () => {
  it('declares a policy for every AgentSignal source type', () => {
    expect(Object.keys(AGENT_SIGNAL_SOURCE_PERSISTENCE).sort()).toEqual(
      Object.values(AGENT_SIGNAL_SOURCE_TYPES).sort(),
    );
    for (const policy of Object.values(AGENT_SIGNAL_SOURCE_PERSISTENCE)) {
      expect(['always', 'on_decision', 'never']).toContain(policy);
    }
  });

  it.each([
    AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep,
    AGENT_SIGNAL_SOURCE_TYPES.runtimeAfterStep,
    AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStepComplete,
    AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
  ])('never persists the high-frequency source %s, even with a decision', (sourceType) => {
    expect(resolveSignalPersistence(sourceType)).toBe('never');
    expect(shouldPersistSignal(resolveSignalPersistence(sourceType), { hasDecision: true })).toBe(
      false,
    );
  });

  it('persists bot messages only when a decision was recorded', () => {
    const policy = resolveSignalPersistence(AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged);

    expect(policy).toBe('on_decision');
    expect(shouldPersistSignal(policy, { hasDecision: false })).toBe(false);
    expect(shouldPersistSignal(policy, { hasDecision: true })).toBe(true);
  });

  it('always persists the mail Oracle and defaults unknown keys to never', () => {
    expect(
      shouldPersistSignal(resolveSignalPersistence('agent-mail'), { hasDecision: false }),
    ).toBe(true);
    expect(resolveSignalPersistence('some.unknown.feed')).toBe('never');
  });
});
