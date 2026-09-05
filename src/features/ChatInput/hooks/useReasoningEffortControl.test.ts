import { renderHook } from '@testing-library/react';
import type { AiModelReasoningConfig } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReasoningEffortControl } from './useReasoningEffortControl';

const testState = vi.hoisted(() => ({
  ai: {
    config: undefined as AiModelReasoningConfig | undefined,
    reasoningParams: [] as string[],
    updateModelReasoningConfig: vi.fn(() => Promise.resolve()),
    updating: false,
  },
  chat: {
    /** keyed by `${topicId}/${provider}/${model}` — mirrors getTopicReasoningConfigForModel */
    topicConfigs: {} as Record<string, AiModelReasoningConfig | undefined>,
    updateTopicReasoningConfig: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: <T>(selector: (state: typeof testState.chat) => T) => selector(testState.chat),
}));

vi.mock('@/store/chat/slices/topic/selectors', () => ({
  topicSelectors: {
    getTopicReasoningConfigForModel:
      (topicId: string, model: string, provider: string) => (state: typeof testState.chat) =>
        state.topicConfigs[`${topicId}/${provider}/${model}`],
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    isModelHasReasoningExtendParams: () => (state: typeof testState.ai) =>
      state.reasoningParams.length > 0,
    isModelReasoningConfigUpdating: () => (state: typeof testState.ai) => state.updating,
    modelReasoningConfig: () => (state: typeof testState.ai) => state.config,
    modelReasoningExtendParams: () => (state: typeof testState.ai) => state.reasoningParams,
  },
  useAiInfraStore: <T>(selector: (state: typeof testState.ai) => T) => selector(testState.ai),
}));

beforeEach(() => {
  testState.ai.config = undefined;
  testState.ai.reasoningParams = [];
  testState.ai.updating = false;
  testState.ai.updateModelReasoningConfig.mockClear();
  testState.chat.topicConfigs = {};
  testState.chat.updateTopicReasoningConfig.mockClear();
});

describe('useReasoningEffortControl', () => {
  it('reports no reasoning params when the model declares none', () => {
    const { result } = renderHook(() => useReasoningEffortControl('gpt-4o', 'openai'));

    expect(result.current.hasReasoningParams).toBe(false);
    expect(result.current.effortKey).toBeUndefined();
    expect(result.current.effortLevels).toEqual([]);
    expect(result.current.hasReasoningMode).toBe(false);
  });

  it('exposes the effort levels and the saved value', () => {
    testState.ai.reasoningParams = ['gpt5ReasoningEffort'];
    testState.ai.config = { gpt5ReasoningEffort: 'high' };

    const { result } = renderHook(() => useReasoningEffortControl('gpt-5', 'openai'));

    expect(result.current.effortKey).toBe('gpt5ReasoningEffort');
    expect(result.current.effortLevels).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(result.current.effortValue).toBe('high');
  });

  it('falls back to the param default, keeping the gpt-5.5 exception', () => {
    testState.ai.reasoningParams = ['gpt5_2ReasoningEffort'];

    const { result: gpt55 } = renderHook(() => useReasoningEffortControl('gpt-5.5', 'openai'));
    expect(gpt55.current.effortValue).toBe('medium');

    const { result: other } = renderHook(() => useReasoningEffortControl('gpt-5.2', 'openai'));
    expect(other.current.effortValue).toBe('none');
  });

  it('keeps the reasoning mode separate from the effort level', () => {
    testState.ai.reasoningParams = ['effort', 'reasoningMode'];
    testState.ai.config = { reasoningMode: 'pro' };

    const { result } = renderHook(() => useReasoningEffortControl('claude', 'anthropic'));

    expect(result.current.effortKey).toBe('effort');
    expect(result.current.hasReasoningMode).toBe(true);
    expect(result.current.modeValue).toBe('pro');
    expect(result.current.modeLevels).toEqual(['standard', 'pro']);
  });

  it('writes the model-instance config, and ignores clicks while a write is in flight', () => {
    testState.ai.reasoningParams = ['effort'];

    const { result, rerender } = renderHook(() => useReasoningEffortControl('claude', 'anthropic'));
    result.current.select({ effort: 'max' });

    expect(testState.ai.updateModelReasoningConfig).toHaveBeenCalledWith('claude', 'anthropic', {
      effort: 'max',
    });

    testState.ai.updating = true;
    rerender();
    result.current.select({ effort: 'low' });

    expect(testState.ai.updateModelReasoningConfig).toHaveBeenCalledTimes(1);
  });

  describe('topic scope', () => {
    it('shows the topic pin over the user-level config when pinned for this model', () => {
      testState.ai.reasoningParams = ['effort', 'reasoningMode'];
      testState.ai.config = { effort: 'low', reasoningMode: 'pro' };
      testState.chat.topicConfigs['topic-1/anthropic/claude'] = { effort: 'max' };

      const { result } = renderHook(() =>
        useReasoningEffortControl('claude', 'anthropic', 'topic-1'),
      );

      expect(result.current.effortValue).toBe('max');
      // the pin replaces the whole config: an unset mode falls back to the param default
      expect(result.current.modeValue).toBe('standard');
    });

    it('falls back to the user-level config when the topic has no pin for this model', () => {
      testState.ai.reasoningParams = ['effort'];
      testState.ai.config = { effort: 'low' };

      const { result } = renderHook(() =>
        useReasoningEffortControl('claude', 'anthropic', 'topic-1'),
      );

      expect(result.current.effortValue).toBe('low');
    });

    it('writes the topic pin (seeded from the user-level config) instead of the user config', () => {
      testState.ai.reasoningParams = ['effort', 'reasoningMode'];
      testState.ai.config = { effort: 'low', reasoningMode: 'pro' };

      const { result } = renderHook(() =>
        useReasoningEffortControl('claude', 'anthropic', 'topic-1'),
      );
      result.current.select({ effort: 'max' });

      expect(testState.chat.updateTopicReasoningConfig).toHaveBeenCalledWith(
        'topic-1',
        { effort: 'max' },
        { effort: 'low', reasoningMode: 'pro' },
      );
      expect(testState.ai.updateModelReasoningConfig).not.toHaveBeenCalled();
    });
  });
});
