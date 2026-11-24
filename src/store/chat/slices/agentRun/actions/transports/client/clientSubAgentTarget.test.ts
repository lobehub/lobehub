import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { resolveClientSubAgentRunConfig } from './clientSubAgentTarget';

describe('resolveClientSubAgentRunConfig', () => {
  const parentEffectiveModel = { model: 'parent-model', provider: 'parent-provider' };

  describe('a copy of the parent', () => {
    it('takes the parent sub-agent override, with its chatConfig', () => {
      const parentSubagent = {
        chatConfig: { enableReasoning: true },
        model: 'sub-model',
        provider: 'sub-provider',
      };

      expect(resolveClientSubAgentRunConfig({ parentEffectiveModel, parentSubagent })).toEqual({
        chatConfigOverride: { enableReasoning: true },
        modelOverride: { model: 'sub-model', provider: 'sub-provider' },
      });
    });

    it('follows the parent effective model when no override is set', () => {
      expect(
        resolveClientSubAgentRunConfig({ parentEffectiveModel, parentSubagent: undefined }),
      ).toEqual({ chatConfigOverride: undefined, modelOverride: parentEffectiveModel });
    });

    it('falls back to the default model when the parent has none', () => {
      expect(resolveClientSubAgentRunConfig({ parentSubagent: undefined }).modelOverride).toEqual({
        model: DEFAULT_MODEL,
        provider: DEFAULT_PROVIDER,
      });
    });
  });

  describe('a named target', () => {
    // The parent's override belongs to copies of the parent, not to another agent.
    it('runs on its own model and ignores the parent sub-agent override', () => {
      const result = resolveClientSubAgentRunConfig({
        parentEffectiveModel,
        parentSubagent: { chatConfig: { enableReasoning: true }, model: 'sub-model' },
        target: { config: { model: 'target-model', provider: 'target-provider' } },
      });

      expect(result).toEqual({
        modelOverride: { model: 'target-model', provider: 'target-provider' },
      });
    });

    it('pins nothing when the target has no complete model', () => {
      const result = resolveClientSubAgentRunConfig({
        parentEffectiveModel,
        parentSubagent: undefined,
        target: { config: { model: 'target-model', provider: undefined } as any },
      });

      expect(result).toEqual({ modelOverride: undefined });
    });
  });
});
