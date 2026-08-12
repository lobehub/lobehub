import { act, renderHook } from '@testing-library/react';
import { ModelProvider } from 'model-bank/modelProvider';
import { afterEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';

import { canSendVoiceMessage, useCanSendVoiceMessage } from './voiceMessageCapability';

const initialAgentState = useAgentStore.getState();
const initialAiInfraState = useAiInfraStore.getState();
const initialChatState = useChatStore.getState();
const initialUserState = useUserStore.getState();

afterEach(() => {
  useAgentStore.setState(initialAgentState, true);
  useAiInfraStore.setState(initialAiInfraState, true);
  useChatStore.setState(initialChatState, true);
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
    useAgentStore.setState({
      agentMap: {
        [agentId]: { chatConfig: {}, model: audioModel.id, provider: ModelProvider.Google },
      },
    } as any);
    useAiInfraStore.setState({ enabledAiModels: [audioModel, textModel] });
    useUserStore.setState({ workspaceUserPreference: {} });
    useChatStore.setState({
      activeAgentId: 'another-agent',
      activeTopicId: 'another-topic',
      topicDataMap: {
        [`agent_${agentId}`]: {
          items: [{ id: topicId, model: audioModel.id, provider: ModelProvider.Google }],
        },
      },
    } as any);
    const context = { agentId, topicId };

    expect(canSendVoiceMessage(context)).toBe(true);

    useChatStore.setState({
      topicDataMap: {
        [`agent_${agentId}`]: {
          items: [{ id: topicId, model: textModel.id, provider: ModelProvider.Google }],
        },
      },
    } as any);

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
      useAgentStore.setState({
        agentMap: {
          [agentId]: {
            chatConfig: {},
            model: audioModel.id,
            provider: ModelProvider.Google,
          },
        },
      } as any);
      useAiInfraStore.setState({ enabledAiModels: [audioModel, textModel] });
      useUserStore.setState({ workspaceUserPreference: {} });
    });

    const context = { agentId };
    const { result } = renderHook(() => useCanSendVoiceMessage(context));

    expect(result.current).toBe(true);

    act(() => {
      useAgentStore.setState({
        agentMap: {
          [agentId]: {
            chatConfig: {},
            model: textModel.id,
            provider: ModelProvider.Google,
          },
        },
      } as any);
    });

    expect(result.current).toBe(false);

    act(() => {
      useAgentStore.setState({
        agentMap: {
          [agentId]: {
            chatConfig: {},
            model: audioModel.id,
            provider: ModelProvider.Google,
          },
        },
      } as any);
    });

    expect(result.current).toBe(true);
  });
});
