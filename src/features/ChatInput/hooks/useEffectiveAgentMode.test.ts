import { describe, expect, it } from 'vitest';

import { resolveEffectiveAgentMode } from './useEffectiveAgentMode';

describe('resolveEffectiveAgentMode', () => {
  it('uses agent mode when the stored mode is enabled and the model supports tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: true, supportToolUse: true })).toEqual({
      canSelectAgentMode: true,
      currentMode: 'agent',
      isAgentModeUnavailable: false,
      isAgentRuntimeMode: true,
      supportToolUse: true,
    });
  });

  it('falls back to chat mode without changing the stored mode when the model lacks tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: true, supportToolUse: false })).toEqual({
      canSelectAgentMode: false,
      currentMode: 'chat',
      isAgentModeUnavailable: true,
      isAgentRuntimeMode: false,
      supportToolUse: false,
    });
  });

  it('keeps explicit chat mode even when the model supports tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: false, supportToolUse: true })).toEqual({
      canSelectAgentMode: true,
      currentMode: 'chat',
      isAgentModeUnavailable: false,
      isAgentRuntimeMode: false,
      supportToolUse: true,
    });
  });
});
