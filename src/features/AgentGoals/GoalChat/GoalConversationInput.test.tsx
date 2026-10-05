/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GoalConversationInput from './GoalConversationInput';

const state = vi.hoisted(() => ({ heterogeneous: false, sendMessage: vi.fn() }));

const conversation = vi.hoisted(() => ({ store: undefined as any }));

vi.mock('@/features/Conversation', async () => {
  const { create } = await import('zustand');
  conversation.store = create(() => ({ messagesInit: false, sendMessage: state.sendMessage }));
  return {
    ChatInput: () => <div data-testid="chat-input" />,
    conversationSelectors: {
      agentId: () => 'agt_1',
      messagesInit: (s: { messagesInit: boolean }) => s.messagesInit,
    },
    useConversationStore: conversation.store,
  };
});

vi.mock('@/routes/(main)/agent/features/Conversation/HeterogeneousChatInput', () => ({
  default: () => <div data-testid="hetero-input" />,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    isAgentConfigLoadingById: () => () => false,
    isAgentHeterogeneousById: () => () => state.heterogeneous,
  },
}));

beforeEach(() => {
  state.heterogeneous = false;
  state.sendMessage.mockReset();
  conversation.store.setState({ messagesInit: false });
});

describe('GoalConversationInput', () => {
  // A Claude Code / Codex goal agent needs its runtime and device controls, so
  // the panel uses the same heterogeneous composer as the agent's own chat.
  it('renders the heterogeneous composer for a heterogeneous agent', () => {
    state.heterogeneous = true;
    render(<GoalConversationInput />);

    expect(screen.getByTestId('hetero-input')).toBeTruthy();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });

  it('sends the handed-off message once, only after the history has loaded', () => {
    render(<GoalConversationInput initialMessage={'what next?'} />);
    expect(state.sendMessage).not.toHaveBeenCalled();

    act(() => conversation.store.setState({ messagesInit: true }));
    act(() => conversation.store.setState({ messagesInit: false }));
    act(() => conversation.store.setState({ messagesInit: true }));

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(state.sendMessage).toHaveBeenCalledWith({ message: 'what next?' });
    expect(screen.getByTestId('chat-input')).toBeTruthy();
  });
});
