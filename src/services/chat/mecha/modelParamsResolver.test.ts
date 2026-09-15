import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';

import {
  createBrowserModelParamsProviders,
  resolveBrowserModelParams,
} from './modelParamsResolver';

const reasoningCard = {
  abilities: { functionCall: true },
  displayName: 'GPT-4 (mine)',
  id: 'gpt-4',
  providerId: 'openai',
  settings: { extendParams: ['reasoningEffort'] },
  type: 'chat',
};

beforeEach(() => {
  useAiInfraStore.setState({
    builtinAiModelList: [
      { abilities: {}, displayName: 'GPT-4', id: 'gpt-4', providerId: 'openai', settings: {} },
      { abilities: { vision: true }, id: 'bank-only', providerId: 'openai' },
    ],
    enabledAiModels: [reasoningCard],
    modelReasoningConfigMap: { 'openai/gpt-4': { reasoningEffort: 'low' } },
  } as any);
  useChatStore.setState({ topicDataMap: {} } as any);
});

describe('createBrowserModelParamsProviders', () => {
  it('lists the enabled models (user settings already merged) ahead of the bundled bank', () => {
    const cards = createBrowserModelParamsProviders({
      model: 'gpt-4',
      provider: 'openai',
    }).listModelCards();

    expect(cards[0]).toMatchObject({
      displayName: 'GPT-4 (mine)',
      extendParams: ['reasoningEffort'],
      id: 'gpt-4',
    });
    expect(cards.find((c) => c.id === 'bank-only')).toMatchObject({ abilities: { vision: true } });
  });

  it('reads the cached model-instance reasoning config', async () => {
    await expect(
      createBrowserModelParamsProviders({ model: 'gpt-4', provider: 'openai' })
        .getModelReasoningConfig!('gpt-4', 'openai'),
    ).resolves.toEqual({ reasoningEffort: 'low' });
  });

  it('returns the topic pin with its ownership so a group pin is scoped to its agent', async () => {
    useChatStore.setState({
      topicDataMap: {
        agt_1: {
          items: [
            {
              agentId: 'agt_1',
              groupId: 'grp_1',
              id: 'tpc_1',
              metadata: { reasoningConfig: { reasoningEffort: 'high' } },
              model: 'gpt-4',
              provider: 'openai',
              title: 't',
            },
            { id: 'tpc_2', title: 'no model pinned' },
          ],
        },
      },
    } as any);
    const providers = createBrowserModelParamsProviders({ model: 'gpt-4', provider: 'openai' });

    await expect(providers.findTopicReasoningPin!('tpc_1')).resolves.toEqual({
      agentId: 'agt_1',
      groupId: 'grp_1',
      model: 'gpt-4',
      provider: 'openai',
      reasoningConfig: { reasoningEffort: 'high' },
    });
    await expect(providers.findTopicReasoningPin!('tpc_2')).resolves.toBeNull();
    await expect(providers.findTopicReasoningPin!('missing')).resolves.toBeNull();
  });
});

describe('resolveBrowserModelParams', () => {
  it('applies the shared rules over the stores', async () => {
    const resolved = await resolveBrowserModelParams({
      agentId: 'agt_1',
      chatConfig: { enableStreaming: false, historyCount: 4 },
      model: 'gpt-4',
      provider: 'openai',
      searchDecision: { enabledSearch: true, useModelSearch: true },
    });

    expect(resolved.resolvedExtendParams).toEqual({ enabledSearch: true, reasoning_effort: 'low' });
    expect(resolved.stream).toBe(false);
    expect(resolved.historyCount).toBe(5);
    expect(resolved.modelDisplayName).toBe('GPT-4 (mine)');
  });

  it('lets the topic pin win only when it belongs to the answering agent', async () => {
    useChatStore.setState({
      topicDataMap: {
        agt_1: {
          items: [
            {
              agentId: 'agt_2',
              groupId: 'grp_1',
              id: 'tpc_1',
              metadata: { reasoningConfig: { reasoningEffort: 'high' } },
              model: 'gpt-4',
              provider: 'openai',
              title: 't',
            },
          ],
        },
      },
    } as any);
    const base = { chatConfig: {}, model: 'gpt-4', provider: 'openai', topicId: 'tpc_1' };

    const other = await resolveBrowserModelParams({ ...base, agentId: 'agt_1' });
    expect(other.resolvedExtendParams).toMatchObject({ reasoning_effort: 'low' });

    const owner = await resolveBrowserModelParams({ ...base, agentId: 'agt_2' });
    expect(owner.resolvedExtendParams).toMatchObject({ reasoning_effort: 'high' });
  });

  it('returns no extend params for a model without any', async () => {
    const resolved = await resolveBrowserModelParams({
      chatConfig: { reasoningEffort: 'high' } as never,
      model: 'bank-only',
      provider: 'openai',
    });
    expect(resolved.resolvedExtendParams).toEqual({});
    expect(resolved.modelHasReasoningExtendParams).toBe(false);
  });

  it('never throws when the stores are empty', async () => {
    useAiInfraStore.setState({ builtinAiModelList: [], enabledAiModels: undefined } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resolved = await resolveBrowserModelParams({
      chatConfig: {},
      model: 'unknown',
      provider: 'nowhere',
    });
    expect(resolved.capabilities.isCanUseFC('unknown', 'nowhere')).toBe(true);
    expect(resolved.shouldReplayAssistantReasoning).toBe(false);
  });
});
