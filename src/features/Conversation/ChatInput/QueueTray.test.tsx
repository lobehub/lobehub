import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueuedMessage } from '@/store/chat/slices/operation/types';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import QueueTray from './QueueTray';

const context = { agentId: 'agt-1', topicId: 'tpc-1' };
const key = messageMapKey(context);

vi.mock('../hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
}));

vi.mock('../store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) => selector({ context, editor: null }),
}));

const serverQueued = (patch: Partial<QueuedMessage> = {}): QueuedMessage => ({
  content: 'next step please',
  createdAt: 1,
  id: 'q1',
  interruptMode: 'soft',
  serverDelivery: 'server',
  serverRequest: { agentId: 'agt-1', appContext: { topicId: 'tpc-1' }, prompt: 'next' },
  ...patch,
});

const setQueue = (messages: QueuedMessage[]) =>
  act(() => {
    useChatStore.setState({ queuedMessages: { [key]: messages } });
  });

const actionLabels = ['inputQueue.edit', 'inputQueue.sendNow', 'inputQueue.delete'];

describe('QueueTray', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  // ROOT CAUSE:
  //
  // A follow-up a live run already took (typed into a Claude Code session the
  // agent had not read yet) kept the waiting caption and its actions; each
  // click answered "Already sent to the agent" while the row stayed.
  //
  // Before: the row ignored the server's `delivering` state.
  // After: it says it is with the agent and offers nothing until given back.
  it('shows a follow-up a run already took as with the agent, without actions', () => {
    setQueue([serverQueued({ serverDelivering: true })]);
    render(<QueueTray />);

    expect(screen.getAllByText('inputQueue.deliveringHint').length).toBeGreaterThan(0);
    expect(screen.queryByText('inputQueue.queuedHint')).toBeNull();
    for (const label of actionLabels) expect(screen.queryByLabelText(label)).toBeNull();
  });

  it('offers the actions again once the server gives it back', () => {
    setQueue([serverQueued({ serverDelivering: true })]);
    render(<QueueTray />);

    setQueue([serverQueued()]);

    expect(screen.getAllByText('inputQueue.queuedHint').length).toBeGreaterThan(0);
    expect(screen.queryByText('inputQueue.deliveringHint')).toBeNull();
    for (const label of actionLabels) expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it('counts only waiting rows in the merged hint and keeps their actions', () => {
    setQueue([serverQueued({ serverDelivering: true }), serverQueued({ id: 'q2' })]);
    render(<QueueTray />);

    // One waiting row: it sends on its own, not merged with the delivering one.
    expect(screen.getAllByText('inputQueue.queuedHint').length).toBeGreaterThan(0);
    expect(screen.queryByText('inputQueue.queuedMergeHint')).toBeNull();
    for (const label of actionLabels) expect(screen.getAllByLabelText(label)).toHaveLength(1);
  });
});
