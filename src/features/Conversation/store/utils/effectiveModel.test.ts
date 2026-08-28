import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';

import {
  getEffectiveConversationModel,
  getEffectiveConversationModelConfig,
  useEffectiveConversationModelConfig,
} from './effectiveModel';

const AGENT_ID = 'agt_test';
const TOPIC_ID = 'tpc_test';

const initialAgentState = useAgentStore.getState();
const initialChatState = useChatStore.getState();
const initialUserState = useUserStore.getState();

afterEach(() => {
  useAgentStore.setState(initialAgentState, true);
  useChatStore.setState(initialChatState, true);
  useUserStore.setState(initialUserState, true);
});

describe('getEffectiveConversationModel', () => {
  it('prefers the topic-scoped model override over the agent default', () => {
    // A topic switched to a Claude 5 model must drive capability guards even
    // when the agent default is still a prefill-capable model.
    useAgentStore.setState({
      agentMap: { [AGENT_ID]: { chatConfig: {}, model: 'gpt-5.2' } },
    } as any);
    useChatStore.setState({
      activeAgentId: AGENT_ID,
      topicDataMap: {
        [`agent_${AGENT_ID}`]: {
          items: [{ id: TOPIC_ID, model: 'claude-opus-5', provider: 'anthropic' }],
        },
      },
    } as any);

    expect(getEffectiveConversationModel({ agentId: AGENT_ID, topicId: TOPIC_ID })).toBe(
      'claude-opus-5',
    );
  });

  it('resolves model and provider from the requested topic instead of the active agent bucket', () => {
    useAgentStore.setState({
      agentMap: {
        [AGENT_ID]: { chatConfig: {}, model: 'gpt-5.2', provider: 'openai' },
        active_agent: { chatConfig: {}, model: 'text-model', provider: 'anthropic' },
      },
    } as any);
    useChatStore.setState({
      activeAgentId: 'active_agent',
      activeTopicId: 'active_topic',
      topicDataMap: {
        [`agent_${AGENT_ID}`]: {
          items: [{ id: TOPIC_ID, model: 'gemini-audio', provider: 'google' }],
        },
        agent_active_agent: {
          items: [{ id: 'active_topic', model: 'text-model', provider: 'anthropic' }],
        },
      },
    } as any);

    expect(getEffectiveConversationModelConfig({ agentId: AGENT_ID, topicId: TOPIC_ID })).toEqual({
      model: 'gemini-audio',
      provider: 'google',
    });
  });

  it('falls back to the agent default when the topic has no model recorded', () => {
    useAgentStore.setState({
      agentMap: { [AGENT_ID]: { chatConfig: {}, model: 'gpt-5.2' } },
    } as any);
    useChatStore.setState({
      activeAgentId: AGENT_ID,
      topicDataMap: {
        [`agent_${AGENT_ID}`]: { items: [{ id: TOPIC_ID }] },
      },
    } as any);

    expect(getEffectiveConversationModel({ agentId: AGENT_ID, topicId: TOPIC_ID })).toBe('gpt-5.2');
  });

  it('applies the workspace member model override for public workspace agents', () => {
    // Generation resolves member overrides via resolveAgentModelConfig for
    // public workspace agents used by non-authors — capability guards must
    // follow the same chain (no current user → non-author).
    useAgentStore.setState({
      agentMap: {
        [AGENT_ID]: {
          chatConfig: {},
          model: 'gpt-5.2',
          userId: 'user_author',
          visibility: 'public',
          workspaceId: 'ws_1',
        },
      },
    } as any);
    useUserStore.setState({
      workspaceUserPreference: {
        agentModelOverrides: { [AGENT_ID]: { model: 'claude-opus-5', provider: 'anthropic' } },
      },
    } as any);

    expect(getEffectiveConversationModel({ agentId: AGENT_ID })).toBe('claude-opus-5');
    expect(getEffectiveConversationModelConfig({ agentId: AGENT_ID })).toMatchObject({
      model: 'claude-opus-5',
      provider: 'anthropic',
    });
  });

  it('applies the member override on a collaborative builtin the caller created', () => {
    // The workspace Agent Builder row is provisioned by whichever member opened
    // it first; being that member must not turn their pick into everyone's.
    useAgentStore.setState({
      agentMap: {
        [AGENT_ID]: {
          chatConfig: {},
          model: 'glm-5.2',
          slug: 'group-agent-builder',
          userId: 'user_self',
          virtual: true,
          visibility: 'public',
          workspaceId: 'ws_1',
        },
      },
    } as any);
    useUserStore.setState({
      user: { id: 'user_self' },
      workspaceUserPreference: {
        agentModelOverrides: { [AGENT_ID]: { model: 'claude-opus-5', provider: 'anthropic' } },
      },
    } as any);

    expect(getEffectiveConversationModel({ agentId: AGENT_ID })).toBe('claude-opus-5');
  });

  it('falls back to the agent default without a topic', () => {
    useAgentStore.setState({
      agentMap: { [AGENT_ID]: { chatConfig: {}, model: 'gpt-5.2' } },
    } as any);

    expect(getEffectiveConversationModel({ agentId: AGENT_ID })).toBe('gpt-5.2');
  });
});

describe('useEffectiveConversationModelConfig', () => {
  it('reacts when a public workspace member selects a personal model override', () => {
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [AGENT_ID]: {
            chatConfig: {},
            model: 'shared-model',
            provider: 'openai',
            userId: 'user_author',
            visibility: 'public',
            workspaceId: 'ws_1',
          },
        },
      } as any);
      useUserStore.setState({
        user: { id: 'user_member' },
        workspaceUserPreference: {},
      } as any);
    });

    const { result } = renderHook(() => useEffectiveConversationModelConfig({ agentId: AGENT_ID }));

    expect(result.current).toEqual({ model: 'shared-model', provider: 'openai' });

    act(() => {
      useUserStore.setState({
        workspaceUserPreference: {
          agentModelOverrides: {
            [AGENT_ID]: { model: 'member-model', provider: 'anthropic' },
          },
        },
      });
    });

    expect(result.current).toEqual({ model: 'member-model', provider: 'anthropic' });
  });

  it('prefers subAgentId over agentId when resolving the shared model', () => {
    const parentAgentId = 'agt_parent';
    const subAgentId = 'agt_sub';
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [parentAgentId]: { chatConfig: {}, model: 'parent-model', provider: 'openai' },
          [subAgentId]: { chatConfig: {}, model: 'subagent-model', provider: 'google' },
        },
      } as any);
      useUserStore.setState({ workspaceUserPreference: {} });
    });

    const { result } = renderHook(() =>
      useEffectiveConversationModelConfig({ agentId: parentAgentId, subAgentId }),
    );

    expect(result.current).toEqual({ model: 'subagent-model', provider: 'google' });
  });

  it('prefers the topic model over the subagent and its member override', () => {
    const parentAgentId = 'agt_topic_parent';
    const subAgentId = 'agt_topic_sub';
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [parentAgentId]: { chatConfig: {}, model: 'parent-model', provider: 'openai' },
          [subAgentId]: {
            chatConfig: {},
            model: 'subagent-model',
            provider: 'google',
            userId: 'user_author',
            visibility: 'public',
            workspaceId: 'ws_1',
          },
        },
      } as any);
      useChatStore.setState({
        topicDataMap: {
          [`agent_${parentAgentId}`]: {
            items: [{ id: TOPIC_ID, model: 'topic-model', provider: 'anthropic' }],
          },
        },
      } as any);
      useUserStore.setState({
        user: { id: 'user_member' },
        workspaceUserPreference: {
          agentModelOverrides: {
            [subAgentId]: { model: 'member-model', provider: 'openai' },
          },
        },
      } as any);
    });

    const { result } = renderHook(() =>
      useEffectiveConversationModelConfig({
        agentId: parentAgentId,
        subAgentId,
        topicId: TOPIC_ID,
      }),
    );

    expect(result.current).toEqual({ model: 'topic-model', provider: 'anthropic' });
  });
});
