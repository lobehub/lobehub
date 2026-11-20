import { ThreadStatus, ThreadType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { ChatStoreState } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { threadSelectors } from '.';

describe('threadSelectors', () => {
  it('returns only an isolation thread for an execution source message', () => {
    const state = {
      activeTopicId: 'topic-1',
      threadMaps: {
        'topic-1': [
          {
            createdAt: new Date(),
            id: 'continuation-thread',
            lastActiveAt: new Date(),
            sourceMessageId: 'message-1',
            status: ThreadStatus.Active,
            title: 'Discussion',
            topicId: 'topic-1',
            type: ThreadType.Continuation,
            updatedAt: new Date(),
            userId: 'user-1',
          },
          {
            createdAt: new Date(),
            id: 'isolation-thread',
            lastActiveAt: new Date(),
            sourceMessageId: 'message-1',
            status: ThreadStatus.Completed,
            title: 'Execution',
            topicId: 'topic-1',
            type: ThreadType.Isolation,
            updatedAt: new Date(),
            userId: 'user-1',
          },
        ],
      },
    } as unknown as ChatStoreState;

    expect(threadSelectors.getIsolationThreadBySourceMsgId('message-1')(state)?.id).toBe(
      'isolation-thread',
    );
  });

  it('does not treat a continuation thread as execution details', () => {
    const state = {
      activeTopicId: 'topic-1',
      threadMaps: {
        'topic-1': [
          {
            createdAt: new Date(),
            id: 'continuation-thread',
            lastActiveAt: new Date(),
            sourceMessageId: 'message-1',
            status: ThreadStatus.Active,
            title: 'Discussion',
            topicId: 'topic-1',
            type: ThreadType.Continuation,
            updatedAt: new Date(),
            userId: 'user-1',
          },
        ],
      },
    } as unknown as ChatStoreState;

    expect(threadSelectors.getIsolationThreadBySourceMsgId('message-1')(state)).toBeUndefined();
  });

  it('keeps direct-mention isolation threads conversational', () => {
    const state = {
      activeThreadId: 'direct-thread',
      activeTopicId: 'topic-1',
      threadMaps: {
        'topic-1': [
          {
            createdAt: new Date(),
            id: 'direct-thread',
            lastActiveAt: new Date(),
            status: ThreadStatus.Completed,
            title: 'Direct Agent run',
            topicId: 'topic-1',
            type: ThreadType.Isolation,
            updatedAt: new Date(),
            userId: 'user-1',
          },
        ],
      },
    } as unknown as ChatStoreState;

    expect(threadSelectors.isActiveThreadSubagent(state)).toBe(false);
  });

  it('keeps tool-spawned isolation threads read-only', () => {
    const state = {
      activeThreadId: 'spawned-thread',
      activeTopicId: 'topic-1',
      threadMaps: {
        'topic-1': [
          {
            createdAt: new Date(),
            id: 'spawned-thread',
            lastActiveAt: new Date(),
            metadata: { sourceToolCallId: 'tool-call-1' },
            status: ThreadStatus.Completed,
            title: 'Spawned subagent',
            topicId: 'topic-1',
            type: ThreadType.Isolation,
            updatedAt: new Date(),
            userId: 'user-1',
          },
        ],
      },
    } as unknown as ChatStoreState;

    expect(threadSelectors.isActiveThreadSubagent(state)).toBe(true);
  });
  it('reads thread replies from the raw rows, not the rendered transcript', () => {
    const mainKey = messageMapKey({ agentId: 'agent-1', topicId: 'topic-1' });
    const state = {
      activeAgentId: 'agent-1',
      activeTopicId: 'topic-1',
      // The rendered transcript deliberately leaves threads out, so the replies only exist
      // in the raw rows. Reading `messagesMap` here would return nothing.
      dbMessagesMap: {
        [mainKey]: [
          { content: 'Question', id: 'message-1' },
          { content: 'Reply', id: 'message-2', threadId: 'thread-1' },
          { content: 'Other thread', id: 'message-3', threadId: 'thread-2' },
        ],
      },
      messagesMap: { [mainKey]: [{ content: 'Question', id: 'message-1' }] },
    } as unknown as ChatStoreState;

    expect(
      threadSelectors
        .getThreadChildMessages('thread-1')(state)
        .map((m) => m.id),
    ).toEqual(['message-2']);
  });
});
