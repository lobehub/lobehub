import { afterEach, describe, expect, it, vi } from 'vitest';

import * as aiInfraStore from '@/store/aiInfra';

import { isCanUseFC } from './isCanUseFC';

const modelWithFC = { abilities: { functionCall: true }, id: 'gpt-4', providerId: 'openai' };
const modelWithoutFC = { abilities: { functionCall: false }, id: 'no-tools', providerId: 'openai' };

const mockAiInfraState = (state: Record<string, unknown>) =>
  vi.spyOn(aiInfraStore, 'getAiInfraStoreState').mockReturnValue(state as any);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isCanUseFC', () => {
  describe('while the aiProvider runtime-state is not ready', () => {
    it('assumes function calling is available (unknown must not be treated as "no FC")', () => {
      mockAiInfraState({ enabledAiModels: [], isInitAiProviderRuntimeState: false });

      // Even though the model is absent from the (empty, not-yet-loaded) list,
      // we must not report `false` — that would force chat mode and drop tools.
      expect(isCanUseFC('gpt-4', 'openai')).toBe(true);
    });

    it('assumes function calling is available for an unknown model too', () => {
      mockAiInfraState({ enabledAiModels: [], isInitAiProviderRuntimeState: false });

      expect(isCanUseFC('claude-sonnet-4-6', 'lobehub')).toBe(true);
    });
  });

  describe('once the aiProvider runtime-state is ready', () => {
    it('returns true when the model supports function calling', () => {
      mockAiInfraState({ enabledAiModels: [modelWithFC], isInitAiProviderRuntimeState: true });

      expect(isCanUseFC('gpt-4', 'openai')).toBe(true);
    });

    it('returns false when the model does not support function calling', () => {
      mockAiInfraState({ enabledAiModels: [modelWithoutFC], isInitAiProviderRuntimeState: true });

      expect(isCanUseFC('no-tools', 'openai')).toBe(false);
    });

    it('returns false when the model is absent from the enabled list', () => {
      mockAiInfraState({ enabledAiModels: [], isInitAiProviderRuntimeState: true });

      expect(isCanUseFC('gpt-4', 'openai')).toBe(false);
    });
  });
});
