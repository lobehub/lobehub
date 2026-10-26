import { renderHook } from '@testing-library/react';
import type { AiModelReasoningConfig, AiModelReasoningEffortSettings } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReasoningEffortControl } from './useReasoningEffortControl';

const testState = vi.hoisted(() => ({
  ai: {
    config: undefined as AiModelReasoningConfig | undefined,
    effort: undefined as AiModelReasoningEffortSettings | undefined,
    reasoningMode: false,
    updateModelReasoningConfig: vi.fn(() => Promise.resolve()),
    updating: false,
  },
  chat: {
    topicEffortUpdatingIds: [] as string[],
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
    isModelHasReasoningControls: () => (state: typeof testState.ai) =>
      !!state.effort || state.reasoningMode,
    isModelHasReasoningMode: () => (state: typeof testState.ai) => state.reasoningMode,
    isModelReasoningConfigUpdating: () => (state: typeof testState.ai) => state.updating,
    modelReasoningConfig: () => (state: typeof testState.ai) => state.config,
    modelReasoningEffortSettings: () => (state: typeof testState.ai) => state.effort,
  },
  useAiInfraStore: <T>(selector: (state: typeof testState.ai) => T) => selector(testState.ai),
}));

const CLAUDE_EFFORT: AiModelReasoningEffortSettings = {
  default: 'high',
  levels: ['low', 'medium', 'high', 'max'],
};

beforeEach(() => {
  testState.ai.config = undefined;
  testState.ai.effort = undefined;
  testState.ai.reasoningMode = false;
  testState.ai.updating = false;
  testState.ai.updateModelReasoningConfig.mockClear();
  testState.chat.topicConfigs = {};
  testState.chat.topicEffortUpdatingIds = [];
  testState.chat.updateTopicReasoningConfig.mockClear();
});

describe('useReasoningEffortControl', () => {
  it('reports no reasoning params when the model declares none', () => {
    const { result } = renderHook(() => useReasoningEffortControl('gpt-4o', 'openai'));

    expect(result.current.hasReasoningParams).toBe(false);
    expect(result.current.hasEffort).toBe(false);
    expect(result.current.effortLevels).toEqual([]);
    expect(result.current.effortValue).toBeUndefined();
    expect(result.current.hasReasoningMode).toBe(false);
  });

  it('exposes the card levels and the saved value', () => {
    testState.ai.effort = { default: 'medium', levels: ['minimal', 'low', 'medium', 'high'] };
    testState.ai.config = { reasoningEffort: 'high' };

    const { result } = renderHook(() => useReasoningEffortControl('gpt-5', 'openai'));

    expect(result.current.hasEffort).toBe(true);
    expect(result.current.effortLevels).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(result.current.effortValue).toBe('high');
  });

  it('shows the card default — the level the runtime sends — when nothing is picked', () => {
    testState.ai.effort = { default: 'high', levels: ['low', 'medium', 'high', 'max'] };

    const { result } = renderHook(() => useReasoningEffortControl('MiniMax-M3.1-Flash', 'minimax'));

    expect(result.current.effortValue).toBe('high');
  });

  it('falls back to the card default when the saved pick is no longer offered', () => {
    testState.ai.effort = { default: 'high', levels: ['low', 'high'] };
    testState.ai.config = { reasoningEffort: 'medium' };

    const { result } = renderHook(() => useReasoningEffortControl('gemini-3-pro', 'google'));

    expect(result.current.effortValue).toBe('high');
  });

  it('keeps the reasoning mode separate from the effort level', () => {
    testState.ai.effort = CLAUDE_EFFORT;
    testState.ai.reasoningMode = true;
    testState.ai.config = { reasoningMode: 'pro' };

    const { result } = renderHook(() => useReasoningEffortControl('claude', 'anthropic'));

    expect(result.current.effortValue).toBe('high');
    expect(result.current.hasReasoningMode).toBe(true);
    expect(result.current.modeValue).toBe('pro');
    expect(result.current.modeLevels).toEqual(['standard', 'pro']);
  });

  it('writes the model-instance config, and ignores clicks while a write is in flight', () => {
    testState.ai.effort = CLAUDE_EFFORT;

    const { result, rerender } = renderHook(() => useReasoningEffortControl('claude', 'anthropic'));
    result.current.select({ reasoningEffort: 'max' });

    expect(testState.ai.updateModelReasoningConfig).toHaveBeenCalledWith('claude', 'anthropic', {
      reasoningEffort: 'max',
    });

    testState.ai.updating = true;
    rerender();
    result.current.select({ reasoningEffort: 'low' });

    expect(testState.ai.updateModelReasoningConfig).toHaveBeenCalledTimes(1);
  });

  describe('topic scope', () => {
    it('uses the topic in-flight state rather than the shared default mutation', () => {
      testState.ai.updating = true;
      const { result, rerender } = renderHook(() =>
        useReasoningEffortControl('claude', 'anthropic', 'topic-1'),
      );
      expect(result.current.updating).toBe(false);
      testState.chat.topicEffortUpdatingIds = ['topic-1'];
      rerender();
      expect(result.current.updating).toBe(true);
      result.current.select({ reasoningEffort: 'high' });
      expect(testState.chat.updateTopicReasoningConfig).not.toHaveBeenCalled();
    });

    it('shows the topic pin over the user-level config when pinned for this model', () => {
      testState.ai.effort = CLAUDE_EFFORT;
      testState.ai.reasoningMode = true;
      testState.ai.config = { reasoningEffort: 'low', reasoningMode: 'pro' };
      testState.chat.topicConfigs['topic-1/anthropic/claude'] = { reasoningEffort: 'max' };

      const { result } = renderHook(() =>
        useReasoningEffortControl('claude', 'anthropic', 'topic-1'),
      );

      expect(result.current.effortValue).toBe('max');
      // the pin replaces the whole config: an unset mode falls back to the param default
      expect(result.current.modeValue).toBe('standard');
    });

    it('falls back to the user-level config when the topic has no pin for this model', () => {
      testState.ai.effort = CLAUDE_EFFORT;
      testState.ai.config = { reasoningEffort: 'low' };

      const { result } = renderHook(() =>
        useReasoningEffortControl('claude', 'anthropic', 'topic-1'),
      );

      expect(result.current.effortValue).toBe('low');
    });

    it('writes the topic pin (seeded from the user-level config) instead of the user config', () => {
      testState.ai.effort = CLAUDE_EFFORT;
      testState.ai.reasoningMode = true;
      testState.ai.config = { reasoningEffort: 'low', reasoningMode: 'pro' };

      const { result } = renderHook(() =>
        useReasoningEffortControl('claude', 'anthropic', 'topic-1'),
      );
      result.current.select({ reasoningEffort: 'max' });

      expect(testState.chat.updateTopicReasoningConfig).toHaveBeenCalledWith(
        'topic-1',
        { reasoningEffort: 'max' },
        { reasoningEffort: 'low', reasoningMode: 'pro' },
      );
      expect(testState.ai.updateModelReasoningConfig).not.toHaveBeenCalled();
    });
  });
});
