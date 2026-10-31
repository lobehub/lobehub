import { type UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { getMessageTranscript } from '@/store/chat/slices/message/transcript';

import { resetTranscripts } from '../../../../message/actions/testUtils';
import { createSubagentStoreDispatcher } from './subagentStoreDispatcher';

const threadContext = {
  agentId: 'agent-1',
  scope: 'thread' as const,
  threadId: 'thread-1',
  topicId: 'topic-1',
};

const row: UIChatMessage = {
  content: '',
  createdAt: 1,
  id: 'msg_subagent',
  role: 'assistant',
  threadId: 'thread-1',
  updatedAt: 1,
};

describe('createSubagentStoreDispatcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTranscripts();
  });

  it('inserts already-persisted subagent rows as server-known', () => {
    const { operationId } = useChatStore.getState().startOperation({
      context: threadContext,
      type: 'subagentThread',
    });
    const dispatch = vi.spyOn(useChatStore.getState(), 'internal_dispatchMessage');
    const stream = createSubagentStoreDispatcher(useChatStore.getState, { operationId });

    stream.create(row);

    expect(dispatch).toHaveBeenCalledWith(
      { id: row.id, type: 'createMessage', value: row },
      { operationId },
      { creationOrigin: 'server' },
    );
    // A later read that omits the row (a remote delete) stays authoritative.
    const transcript = getMessageTranscript(useChatStore.setState, useChatStore.getState);
    expect(transcript.debugUnconfirmedClientIds()).not.toContain(row.id);
  });
});
