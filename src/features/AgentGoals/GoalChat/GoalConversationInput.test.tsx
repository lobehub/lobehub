/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GoalConversationInput from './GoalConversationInput';

const state = vi.hoisted(() => ({
  configLoading: false,
  fillInputMessage: vi.fn(),
  heterogeneous: false,
  sendMessage: vi.fn(),
}));

const conversation = vi.hoisted(() => ({ store: undefined as any }));

vi.mock('@/features/Conversation', async () => {
  const { create } = await import('zustand');
  conversation.store = create(() => ({
    editor: null as unknown,
    fillInputMessage: state.fillInputMessage,
    messagesInit: false,
    sendMessage: state.sendMessage,
  }));
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
    isAgentConfigLoadingById: () => () => state.configLoading,
    isAgentHeterogeneousById: () => () => state.heterogeneous,
  },
}));

beforeEach(() => {
  state.configLoading = false;
  state.heterogeneous = false;
  state.fillInputMessage.mockReset();
  state.sendMessage.mockReset();
  conversation.store.setState({ editor: null, messagesInit: false });
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
    const onSent = vi.fn();
    render(
      <GoalConversationInput initialMessage={'what next?'} onInitialMessageConsumed={onSent} />,
    );
    expect(state.sendMessage).not.toHaveBeenCalled();

    act(() => conversation.store.setState({ messagesInit: true }));
    act(() => conversation.store.setState({ messagesInit: false }));
    act(() => conversation.store.setState({ messagesInit: true }));

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(state.sendMessage).toHaveBeenCalledWith({ message: 'what next?' });
    // The host is told, so a later remount of the panel gets no message to resend.
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-input')).toBeTruthy();
  });

  // The heterogeneous composer gates sending on API binding, execution target
  // and device state; the hand-off must go through it rather than around it.
  it('fills a heterogeneous agent’s composer instead of sending around its guards', () => {
    state.heterogeneous = true;
    const onConsumed = vi.fn();
    render(
      <GoalConversationInput initialMessage={'what next?'} onInitialMessageConsumed={onConsumed} />,
    );

    act(() => conversation.store.setState({ messagesInit: true }));
    expect(state.fillInputMessage).not.toHaveBeenCalled();

    act(() => conversation.store.setState({ editor: {} }));

    expect(state.fillInputMessage).toHaveBeenCalledWith('what next?');
    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it('waits for the agent config before choosing how to hand off', () => {
    state.configLoading = true;
    conversation.store.setState({ messagesInit: true });
    const { rerender } = render(<GoalConversationInput initialMessage={'what next?'} />);
    expect(state.sendMessage).not.toHaveBeenCalled();

    state.configLoading = false;
    rerender(
      <GoalConversationInput initialMessage={'what next?'} onInitialMessageConsumed={vi.fn()} />,
    );
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
  });
});
