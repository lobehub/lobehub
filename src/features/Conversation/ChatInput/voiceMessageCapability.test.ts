import { act, renderHook } from '@testing-library/react';
import { ModelProvider } from 'model-bank/modelProvider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProjectionStoreState, useProjectionStore } from '@/projection';
import { useAiInfraStore } from '@/store/aiInfra';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useUserStore } from '@/store/user';

import { canSendVoiceMessage, useCanSendVoiceMessage } from './voiceMessageCapability';

const initialAiInfraState = useAiInfraStore.getState();
const initialUserState = useUserStore.getState();
const SCOPE = 'user-1:personal';

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => SCOPE,
  isAnonymousScope: () => false,
  isScopeTrusted: () => true,
  useCacheScope: () => SCOPE,
}));

const seedAgent = (id: string, model: string) => {
  getProjectionStoreState().commitAgentConfig(
    SCOPE,
    { chatConfig: {}, id, model, provider: ModelProvider.Google },
    'full',
    'network',
  );
};

const seedTopic = (agentId: string, id: string, model: string, observedAt: number) => {
  getProjectionStoreState().commitChatTopicsPage(
    SCOPE,
    {
      containerKey: topicMapKey({ agentId }),
      context: { agentId },
      items: [
        {
          createdAt: 0,
          id,
          model,
          provider: ModelProvider.Google,
          title: '',
          updatedAt: observedAt,
        } as any,
      ],
      page: 0,
      pageSize: 20,
      signature: {},
      surface: 'sidebar',
      total: 1,
    },
    { observedAt, source: 'network' },
  );
};

beforeEach(() => {
  useProjectionStore.setState({ scopes: {} });
});

afterEach(() => {
  useProjectionStore.setState({ scopes: {} });
  useAiInfraStore.setState(initialAiInfraState, true);
  useUserStore.setState(initialUserState, true);
});

describe('canSendVoiceMessage', () => {
  it('rechecks the transaction topic capability without depending on the mounted chat input', () => {
    const agentId = 'voice-agent';
    const topicId = 'voice-topic';
    const audioModel = {
      abilities: { audio: true },
      enabled: true,
      id: 'gemini-audio',
      providerId: ModelProvider.Google,
      type: 'chat',
    } as const;
    const textModel = {
      abilities: {},
      enabled: true,
      id: 'text-only',
      providerId: ModelProvider.Google,
      type: 'chat',
    } as const;
    seedAgent(agentId, audioModel.id);
    useAiInfraStore.setState({ enabledAiModels: [audioModel, textModel] });
    useUserStore.setState({ workspaceUserPreference: {} });
    seedTopic(agentId, topicId, audioModel.id, 1);
    const context = { agentId, topicId };

    expect(canSendVoiceMessage(context)).toBe(true);

    seedTopic(agentId, topicId, textModel.id, 2);

    expect(canSendVoiceMessage(context)).toBe(false);
  });
});

describe('useCanSendVoiceMessage', () => {
  it('updates when the effective conversation model switches capability', () => {
    const agentId = 'reactive-voice-agent';
    const audioModel = {
      abilities: { audio: true },
      enabled: true,
      id: 'gemini-audio',
      providerId: ModelProvider.Google,
      type: 'chat',
    } as const;
    const textModel = {
      abilities: {},
      enabled: true,
      id: 'text-only',
      providerId: ModelProvider.Google,
      type: 'chat',
    } as const;
    act(() => {
      seedAgent(agentId, audioModel.id);
      useAiInfraStore.setState({ enabledAiModels: [audioModel, textModel] });
      useUserStore.setState({ workspaceUserPreference: {} });
    });

    const context = { agentId };
    const { result } = renderHook(() => useCanSendVoiceMessage(context));

    expect(result.current).toBe(true);

    act(() => {
      seedAgent(agentId, textModel.id);
    });

    expect(result.current).toBe(false);

    act(() => {
      seedAgent(agentId, audioModel.id);
    });

    expect(result.current).toBe(true);
  });
});
