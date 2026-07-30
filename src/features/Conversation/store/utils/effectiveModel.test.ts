import { afterEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { getEffectiveConversationModel } from './effectiveModel';

const AGENT_ID = 'agt_test';
const TOPIC_ID = 'tpc_test';

const initialAgentState = useAgentStore.getState();
const initialChatState = useChatStore.getState();

afterEach(() => {
  useAgentStore.setState(initialAgentState, true);
  useChatStore.setState(initialChatState, true);
});

describe('getEffectiveConversationModel', () => {
  it('prefers the topic-scoped model override over the agent default', () => {
    // A topic switched to a Claude 5 model must drive capability guards even
    // when the agent default is still a prefill-capable model (LOBE-12572).
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

  it('falls back to the agent default without a topic', () => {
    useAgentStore.setState({
      agentMap: { [AGENT_ID]: { chatConfig: {}, model: 'gpt-5.2' } },
    } as any);

    expect(getEffectiveConversationModel({ agentId: AGENT_ID })).toBe('gpt-5.2');
  });
});
