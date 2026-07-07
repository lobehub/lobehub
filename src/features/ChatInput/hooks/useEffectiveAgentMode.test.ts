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

  describe('when the model list is not ready yet', () => {
    it('honours stored agent mode instead of downgrading on the transient unknown', () => {
      // supportToolUse is `false` only because the model has not hydrated yet.
      // We must NOT flash to chat mode / mark agent mode unavailable.
      expect(
        resolveEffectiveAgentMode({
          enableAgentMode: true,
          isModelListReady: false,
          supportToolUse: false,
        }),
      ).toEqual({
        canSelectAgentMode: true,
        currentMode: 'agent',
        isAgentModeUnavailable: false,
        isAgentRuntimeMode: true,
        supportToolUse: true,
      });
    });

    it('still respects an explicit chat-mode choice while not ready', () => {
      expect(
        resolveEffectiveAgentMode({
          enableAgentMode: false,
          isModelListReady: false,
          supportToolUse: false,
        }),
      ).toEqual({
        canSelectAgentMode: true,
        currentMode: 'chat',
        isAgentModeUnavailable: false,
        isAgentRuntimeMode: false,
        supportToolUse: true,
      });
    });

    it('applies the real capability once the list becomes ready', () => {
      expect(
        resolveEffectiveAgentMode({
          enableAgentMode: true,
          isModelListReady: true,
          supportToolUse: false,
        }),
      ).toEqual({
        canSelectAgentMode: false,
        currentMode: 'chat',
        isAgentModeUnavailable: true,
        isAgentRuntimeMode: false,
        supportToolUse: false,
      });
    });
  });
});
