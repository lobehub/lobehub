import { act, renderHook } from '@testing-library/react';
import { ModelProvider } from 'model-bank/modelProvider';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import {
  createServerConfigStore,
  initServerConfigStore,
  Provider as ServerConfigProvider,
} from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import { canSendVoiceMessage, useCanSendVoiceMessage } from './voiceMessageCapability';

vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => ({ canManageAgent: false, isAccessLoading: false }),
}));

const initialAgentState = useAgentStore.getState();
const initialAiInfraState = useAiInfraStore.getState();
const initialChatState = useChatStore.getState();
const initialUserState = useUserStore.getState();

const multimodalServerConfig = {
  aiProvider: {},
  enableMultimodalUnderstanding: true,
  multimodalUnderstanding: {
    model: 'fallback-audio-model',
    provider: ModelProvider.LobeHub,
  },
  telemetry: {},
};

const serverConfigStore = createServerConfigStore({ serverConfig: multimodalServerConfig });

const ServerConfigWrapper = ({ children }: PropsWithChildren) =>
  createElement(ServerConfigProvider, {
    children,
    createStore: () => initServerConfigStore({}),
  });

const MultimodalServerConfigWrapper = ({ children }: PropsWithChildren) =>
  createElement(ServerConfigProvider, {
    children,
    createStore: () =>
      initServerConfigStore({
        serverConfig: multimodalServerConfig,
      }),
  });

afterEach(() => {
  useAgentStore.setState(initialAgentState, true);
  useAiInfraStore.setState(initialAiInfraState, true);
  useChatStore.setState(initialChatState, true);
  useUserStore.setState(initialUserState, true);
  serverConfigStore.setState({ serverConfig: multimodalServerConfig });
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

  it('uses a public Workspace member personal Chat/Agent mode when rechecking send', () => {
    const agentId = 'workspace-voice-agent';
    const primaryModel = {
      abilities: { functionCall: true },
      enabled: true,
      id: 'deepseek-v4-pro',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    const fallbackModel = {
      abilities: { audio: true },
      enabled: true,
      id: 'fallback-audio-model',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    useAgentStore.setState({
      agentMap: {
        [agentId]: {
          chatConfig: { enableAgentMode: true },
          model: primaryModel.id,
          provider: ModelProvider.LobeHub,
          userId: 'user-author',
          visibility: 'public',
          workspaceId: 'workspace-1',
        },
      },
    } as any);
    useAiInfraStore.setState({ enabledAiModels: [primaryModel, fallbackModel] });
    useUserStore.setState({
      user: { id: 'user-member' },
      workspaceUserPreference: { agentModeOverrides: { [agentId]: true } },
    } as any);

    // The unkeyed preference bucket may still belong to the previous Workspace.
    // Send-time validation must not trust it before the current Workspace hydrates.
    expect(canSendVoiceMessage({ agentId })).toBe(false);

    useUserStore.setState({
      workspaceUserPreference: { agentModeOverrides: { [agentId]: false } },
      workspaceUserPreferenceWorkspaceId: 'workspace-1',
    });

    expect(canSendVoiceMessage({ agentId })).toBe(false);

    useUserStore.setState({
      workspaceUserPreference: { agentModeOverrides: { [agentId]: true } },
    });

    expect(canSendVoiceMessage({ agentId })).toBe(true);
  });
});

describe('useCanSendVoiceMessage', () => {
  it('reacts to Agent mode when voice requires the multimodal fallback tool', () => {
    const agentId = 'fallback-voice-agent';
    const primaryModel = {
      abilities: { functionCall: true },
      enabled: true,
      id: 'deepseek-v4-pro',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    const fallbackModel = {
      abilities: { audio: true },
      enabled: true,
      id: 'fallback-audio-model',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [agentId]: {
            chatConfig: { enableAgentMode: false },
            model: primaryModel.id,
            provider: ModelProvider.LobeHub,
          },
        },
      } as any);
      useAiInfraStore.setState({ enabledAiModels: [primaryModel, fallbackModel] });
      useUserStore.setState({ workspaceUserPreference: {} });
    });

    const { result } = renderHook(() => useCanSendVoiceMessage({ agentId }), {
      wrapper: MultimodalServerConfigWrapper,
    });

    expect(result.current).toBe(false);

    act(() => {
      useAgentStore.setState({
        agentMap: {
          [agentId]: {
            chatConfig: { enableAgentMode: true },
            model: primaryModel.id,
            provider: ModelProvider.LobeHub,
          },
        },
      } as any);
    });

    expect(result.current).toBe(true);
  });

  it('reacts to a public Workspace member personal Chat/Agent mode', () => {
    const agentId = 'workspace-reactive-voice-agent';
    const primaryModel = {
      abilities: { functionCall: true },
      enabled: true,
      id: 'deepseek-v4-flash',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    const fallbackModel = {
      abilities: { audio: true },
      enabled: true,
      id: 'fallback-audio-model',
      providerId: ModelProvider.LobeHub,
      type: 'chat',
    } as const;
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [agentId]: {
            chatConfig: { enableAgentMode: true },
            model: primaryModel.id,
            provider: ModelProvider.LobeHub,
            userId: 'user-author',
            visibility: 'public',
            workspaceId: 'workspace-1',
          },
        },
      } as any);
      useAiInfraStore.setState({ enabledAiModels: [primaryModel, fallbackModel] });
      useUserStore.setState({
        user: { id: 'user-member' },
        workspaceUserPreference: { agentModeOverrides: { [agentId]: false } },
      } as any);
    });

    const { result } = renderHook(() => useCanSendVoiceMessage({ agentId }), {
      wrapper: MultimodalServerConfigWrapper,
    });

    expect(result.current).toBe(false);

    act(() => {
      useUserStore.setState({
        workspaceUserPreference: { agentModeOverrides: { [agentId]: true } },
      });
    });

    expect(result.current).toBe(true);
  });

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
    const { result } = renderHook(() => useCanSendVoiceMessage(context), {
      wrapper: ServerConfigWrapper,
    });

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
