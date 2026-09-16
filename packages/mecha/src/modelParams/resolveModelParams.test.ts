import { describe, expect, it, vi } from 'vitest';

import { resolveHistoryCount, resolveModelParams } from './resolveModelParams';
import type { ModelCardFacts, ModelParamsProviders, ModelParamsRequest } from './types';

const cards: ModelCardFacts[] = [
  {
    abilities: { functionCall: true, vision: true },
    displayName: 'GPT-4',
    extendParams: ['reasoningEffort'],
    id: 'gpt-4',
    knowledgeCutoff: '2024-01',
    providerId: 'openai',
  },
  {
    abilities: {},
    displayName: 'DeepSeek V4 Pro',
    extendParams: ['deepseekV4ReasoningEffort'],
    id: 'deepseek-v4-pro',
    providerId: 'deepseek',
  },
  { abilities: { functionCall: false }, displayName: 'Plain', id: 'plain', providerId: 'openai' },
  {
    abilities: { vision: true },
    displayName: 'GPT-4 (hub)',
    extendParams: ['reasoningEffort'],
    id: 'gpt-4',
    knowledgeCutoff: '2024-01',
    providerId: 'lobehub',
  },
];

const providers = (overrides: Partial<ModelParamsProviders> = {}): ModelParamsProviders => ({
  listModelCards: () => cards,
  ...overrides,
});

const request = (overrides: Partial<ModelParamsRequest> = {}): ModelParamsRequest => ({
  agent: { chatConfig: {}, id: 'agt_1' },
  model: 'gpt-4',
  provider: 'openai',
  topicId: 'tpc_1',
  ...overrides,
});

describe('resolveModelParams', () => {
  describe('extend params', () => {
    it('lets the user row win, treats an emptied row as an opt-out and falls back to the cards', async () => {
      const own = await resolveModelParams(
        request(),
        providers({ getUserModelRow: async () => ({ extendParams: ['thinking'] }) }),
      );
      expect(own.modelExtendParams).toEqual(['thinking']);
      expect(own.modelHasReasoningExtendParams).toBe(false);

      const optedOut = await resolveModelParams(
        request(),
        providers({ getUserModelRow: async () => ({ extendParams: [] }) }),
      );
      expect(optedOut.modelExtendParams).toEqual([]);

      const fromCard = await resolveModelParams(request(), providers());
      expect(fromCard.modelExtendParams).toEqual(['reasoningEffort']);
      expect(fromCard.modelHasReasoningExtendParams).toBe(true);
    });

    it('falls back to the canonical card for an aggregation provider', async () => {
      const facts = await resolveModelParams(
        request({ provider: 'lobehub' }),
        providers({
          listModelCards: () => [{ ...cards[3], extendParams: undefined }, cards[0]],
        }),
      );
      expect(facts.modelExtendParams).toEqual(['reasoningEffort']);
      expect(facts.modelKnowledgeCutoff).toBe('2024-01');
    });

    it('applies the effective config to the payload params', async () => {
      const facts = await resolveModelParams(
        request(),
        providers({ getModelReasoningConfig: async () => ({ reasoningEffort: 'high' }) }),
      );
      expect(facts.resolvedExtendParams).toMatchObject({ reasoning_effort: 'high' });
    });
  });

  describe('reasoning config precedence', () => {
    it('lets the topic pin win over the model-instance config', async () => {
      const facts = await resolveModelParams(
        request(),
        providers({
          findTopicReasoningPin: async () => ({
            model: 'gpt-4',
            provider: 'openai',
            reasoningConfig: { reasoningEffort: 'low' },
          }),
          getModelReasoningConfig: async () => ({ reasoningEffort: 'high' }),
        }),
      );
      expect(facts.resolvedExtendParams).toMatchObject({ reasoning_effort: 'low' });
    });

    it('ignores a pin taken for another model or, in a group topic, for another agent', async () => {
      const getModelReasoningConfig = vi.fn(async () => ({ reasoningEffort: 'high' as const }));
      const otherModel = await resolveModelParams(
        request(),
        providers({
          findTopicReasoningPin: async () => ({
            model: 'gpt-4o',
            provider: 'openai',
            reasoningConfig: { reasoningEffort: 'low' },
          }),
          getModelReasoningConfig,
        }),
      );
      expect(otherModel.resolvedExtendParams).toMatchObject({ reasoning_effort: 'high' });

      const otherAgent = await resolveModelParams(
        request(),
        providers({
          findTopicReasoningPin: async () => ({
            agentId: 'agt_2',
            groupId: 'grp_1',
            model: 'gpt-4',
            provider: 'openai',
            reasoningConfig: { reasoningEffort: 'low' },
          }),
          getModelReasoningConfig,
        }),
      );
      expect(otherAgent.resolvedExtendParams).toMatchObject({ reasoning_effort: 'high' });
    });

    it('treats an empty pin as the defaults but a legacy topic without one as unpinned', async () => {
      const getModelReasoningConfig = vi.fn(async () => ({ reasoningEffort: 'low' as const }));
      const pinned = await resolveModelParams(
        request(),
        providers({
          findTopicReasoningPin: async () => ({
            model: 'gpt-4',
            provider: 'openai',
            reasoningConfig: {},
          }),
          getModelReasoningConfig,
        }),
      );
      expect(getModelReasoningConfig).not.toHaveBeenCalled();
      expect(pinned.resolvedExtendParams).toEqual({});

      const legacy = await resolveModelParams(
        request(),
        providers({
          findTopicReasoningPin: async () => ({ model: 'gpt-4', provider: 'openai' }),
          getModelReasoningConfig,
        }),
      );
      expect(legacy.resolvedExtendParams).toMatchObject({ reasoning_effort: 'low' });
    });

    it('does not read either source for a model without reasoning extend params', async () => {
      const findTopicReasoningPin = vi.fn();
      const getModelReasoningConfig = vi.fn();
      await resolveModelParams(
        request({ model: 'plain' }),
        providers({ findTopicReasoningPin, getModelReasoningConfig }),
      );
      expect(findTopicReasoningPin).not.toHaveBeenCalled();
      expect(getModelReasoningConfig).not.toHaveBeenCalled();
    });

    it('lets explicit sub-agent overrides win over the instance config', async () => {
      const facts = await resolveModelParams(
        request({
          agent: { chatConfig: {}, subAgentChatConfigOverride: { reasoningEffort: 'low' } },
        }),
        providers({ getModelReasoningConfig: async () => ({ reasoningEffort: 'high' }) }),
      );
      expect(facts.resolvedExtendParams).toMatchObject({ reasoning_effort: 'low' });
    });
  });

  describe('assistant reasoning replay', () => {
    it('replays only when configured and supported by the card', async () => {
      const off = await resolveModelParams(request(), providers());
      expect(off.shouldReplayAssistantReasoning).toBe(false);
      expect(off.preserveThinkingForPayload).toBeUndefined();

      const withCard = providers({
        listModelCards: () => [{ ...cards[0], extendParams: ['preserveThinking'] }],
      });
      const on = await resolveModelParams(
        request({ agent: { chatConfig: { preserveThinking: true } } }),
        withCard,
      );
      expect(on.shouldReplayAssistantReasoning).toBe(true);
      expect(on.preserveThinkingForPayload).toBe(true);

      const declined = await resolveModelParams(
        request({ agent: { chatConfig: { preserveThinking: false } } }),
        withCard,
      );
      expect(declined.shouldReplayAssistantReasoning).toBe(false);
      expect(declined.preserveThinkingForPayload).toBe(false);
    });

    it('forces replay for DeepSeek thinking models unless V4 thinking is disabled', async () => {
      const forced = await resolveModelParams(
        request({ model: 'deepseek-v4-pro', provider: 'deepseek' }),
        providers(),
      );
      expect(forced.shouldReplayAssistantReasoning).toBe(true);
      expect(forced.preserveThinkingForPayload).toBe(true);

      const disabled = await resolveModelParams(
        request({ model: 'deepseek-v4-pro', provider: 'deepseek' }),
        providers({
          getModelReasoningConfig: async () => ({ deepseekV4ReasoningEffort: 'none' }),
        }),
      );
      expect(disabled.shouldReplayAssistantReasoning).toBe(false);
    });

    it('forces replay for Meta and falls back to the provider for an unknown qwen model', async () => {
      const meta = await resolveModelParams(
        request({ model: 'llama-x', provider: 'meta' }),
        providers(),
      );
      expect(meta.shouldReplayAssistantReasoning).toBe(true);

      const qwen = await resolveModelParams(
        request({
          agent: { chatConfig: { preserveThinking: true } },
          model: 'qwen-unknown',
          provider: 'qwen',
        }),
        providers(),
      );
      expect(qwen.shouldReplayAssistantReasoning).toBe(true);
    });
  });

  describe('capabilities', () => {
    it('prefers the frozen snapshot, then the user row, then the cards', async () => {
      const snapshot = await resolveModelParams(
        request({ mediaCapabilities: { vision: false } }),
        providers({ getUserModelRow: async () => ({ abilities: { vision: true } }) }),
      );
      expect(snapshot.capabilities.isCanUseVision('gpt-4', 'openai')).toBe(false);
      // The snapshot never applies to another model.
      expect(snapshot.capabilities.isCanUseVision('gpt-4', 'lobehub')).toBe(true);

      const row = await resolveModelParams(
        request(),
        providers({ getUserModelRow: async () => ({ abilities: { vision: false } }) }),
      );
      expect(row.capabilities.isCanUseVision('gpt-4', 'openai')).toBe(false);

      const card = await resolveModelParams(request(), providers());
      expect(card.capabilities.isCanUseVision('gpt-4', 'openai')).toBe(true);
      expect(card.capabilities.isCanUseAudio('gpt-4', 'openai')).toBe(false);
    });

    it('assumes function calling for an unknown model and honors an explicit false', async () => {
      const facts = await resolveModelParams(request(), providers());
      expect(facts.capabilities.isCanUseFC('unknown', 'openai')).toBe(true);
      expect(facts.capabilities.isCanUseFC('plain', 'openai')).toBe(false);
    });
  });

  describe('chat config passthrough', () => {
    it('keeps the stored agent mode, reads stream and the history window from the config', async () => {
      const facts = await resolveModelParams(
        request({
          agent: {
            chatConfig: { enableAgentMode: true, enableStreaming: false, historyCount: 0 },
          },
          model: 'plain',
        }),
        providers(),
      );
      // A model without function calling does not demote the agent mode.
      expect(facts.enableAgentMode).toBe(true);
      expect(facts.stream).toBe(false);
      expect(facts.historyCount).toBe(1);

      const defaults = await resolveModelParams(request({ agent: {} }), providers());
      expect(defaults.enableAgentMode).toBeUndefined();
      expect(defaults.stream).toBe(true);
      expect(defaults.historyCount).toBeUndefined();
    });

    it('emits enabledSearch only when the decision enables model search', async () => {
      const on = await resolveModelParams(
        request({ searchDecision: { enabledSearch: true, useModelSearch: true } }),
        providers(),
      );
      expect(on.resolvedExtendParams).toMatchObject({ enabledSearch: true });
      const off = await resolveModelParams(
        request({ searchDecision: { enabledSearch: true, useModelSearch: false } }),
        providers(),
      );
      expect(off.resolvedExtendParams?.enabledSearch).toBeUndefined();
    });
  });
});

describe('resolveHistoryCount', () => {
  it('adds the current turn and leaves unset alone', () => {
    expect(resolveHistoryCount(0)).toBe(1);
    expect(resolveHistoryCount(20)).toBe(21);
    expect(resolveHistoryCount(undefined)).toBeUndefined();
    expect(resolveHistoryCount(null)).toBeUndefined();
  });
});
