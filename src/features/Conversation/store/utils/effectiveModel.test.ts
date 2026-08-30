import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProjectionStoreState, useProjectionStore } from '@/projection';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useUserStore } from '@/store/user';

import {
  getEffectiveConversationModel,
  getEffectiveConversationModelConfig,
  useEffectiveConversationModelConfig,
} from './effectiveModel';

const AGENT_ID = 'agt_test';
const TOPIC_ID = 'tpc_test';
const SCOPE = 'user-1:personal';

const initialUserState = useUserStore.getState();

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => SCOPE,
  isAnonymousScope: () => false,
  isScopeTrusted: () => true,
  useCacheScope: () => SCOPE,
}));

const seedAgent = (id: string, agent: Record<string, unknown>) => {
  getProjectionStoreState().commitAgentConfig(SCOPE, { id, ...agent }, 'full', 'network');
};

const seedTopic = (agentId: string, topic: Record<string, unknown>) => {
  getProjectionStoreState().commitChatTopicsPage(
    SCOPE,
    {
      containerKey: topicMapKey({ agentId }),
      context: { agentId },
      items: [{ createdAt: 0, title: '', updatedAt: 0, ...topic } as any],
      page: 0,
      pageSize: 20,
      signature: {},
      surface: 'sidebar',
      total: 1,
    },
    { observedAt: 1, source: 'network' },
  );
};

beforeEach(() => {
  useProjectionStore.setState({ scopes: {} });
});

afterEach(() => {
  useProjectionStore.setState({ scopes: {} });
  useUserStore.setState(initialUserState, true);
});

describe('getEffectiveConversationModel', () => {
  it('prefers the topic-scoped model override over the agent default', () => {
    // A topic switched to a Claude 5 model must drive capability guards even
    // when the agent default is still a prefill-capable model.
    seedAgent(AGENT_ID, { chatConfig: {}, model: 'gpt-5.2' });
    seedTopic(AGENT_ID, { id: TOPIC_ID, model: 'claude-opus-5', provider: 'anthropic' });

    expect(getEffectiveConversationModel({ agentId: AGENT_ID, topicId: TOPIC_ID })).toBe(
      'claude-opus-5',
    );
  });

  it('resolves model and provider from the requested topic instead of the active agent bucket', () => {
    seedAgent(AGENT_ID, { chatConfig: {}, model: 'gpt-5.2', provider: 'openai' });
    seedAgent('active_agent', { chatConfig: {}, model: 'text-model', provider: 'anthropic' });
    seedTopic(AGENT_ID, { id: TOPIC_ID, model: 'gemini-audio', provider: 'google' });
    seedTopic('active_agent', {
      id: 'active_topic',
      model: 'text-model',
      provider: 'anthropic',
    });

    expect(getEffectiveConversationModelConfig({ agentId: AGENT_ID, topicId: TOPIC_ID })).toEqual({
      model: 'gemini-audio',
      provider: 'google',
    });
  });

  it('falls back to the agent default when the topic has no model recorded', () => {
    seedAgent(AGENT_ID, { chatConfig: {}, model: 'gpt-5.2' });
    seedTopic(AGENT_ID, { id: TOPIC_ID });

    expect(getEffectiveConversationModel({ agentId: AGENT_ID, topicId: TOPIC_ID })).toBe('gpt-5.2');
  });

  it('applies the workspace member model override for public workspace agents', () => {
    // Generation resolves member overrides via resolveAgentModelConfig for
    // public workspace agents used by non-authors — capability guards must
    // follow the same chain (no current user → non-author).
    seedAgent(AGENT_ID, {
      chatConfig: {},
      model: 'gpt-5.2',
      userId: 'user_author',
      visibility: 'public',
      workspaceId: 'ws_1',
    });
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
    seedAgent(AGENT_ID, {
      chatConfig: {},
      model: 'glm-5.2',
      slug: 'group-agent-builder',
      userId: 'user_self',
      virtual: true,
      visibility: 'public',
      workspaceId: 'ws_1',
    });
    useUserStore.setState({
      user: { id: 'user_self' },
      workspaceUserPreference: {
        agentModelOverrides: { [AGENT_ID]: { model: 'claude-opus-5', provider: 'anthropic' } },
      },
    } as any);

    expect(getEffectiveConversationModel({ agentId: AGENT_ID })).toBe('claude-opus-5');
  });

  it('falls back to the agent default without a topic', () => {
    seedAgent(AGENT_ID, { chatConfig: {}, model: 'gpt-5.2' });

    expect(getEffectiveConversationModel({ agentId: AGENT_ID })).toBe('gpt-5.2');
  });
});

describe('useEffectiveConversationModelConfig', () => {
  it('reacts when a public workspace member selects a personal model override', () => {
    act(() => {
      seedAgent(AGENT_ID, {
        chatConfig: {},
        model: 'shared-model',
        provider: 'openai',
        userId: 'user_author',
        visibility: 'public',
        workspaceId: 'ws_1',
      });
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
      seedAgent(parentAgentId, { chatConfig: {}, model: 'parent-model', provider: 'openai' });
      seedAgent(subAgentId, { chatConfig: {}, model: 'subagent-model', provider: 'google' });
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
      seedAgent(parentAgentId, { chatConfig: {}, model: 'parent-model', provider: 'openai' });
      seedAgent(subAgentId, {
        chatConfig: {},
        model: 'subagent-model',
        provider: 'google',
        userId: 'user_author',
        visibility: 'public',
        workspaceId: 'ws_1',
      });
      seedTopic(parentAgentId, { id: TOPIC_ID, model: 'topic-model', provider: 'anthropic' });
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
