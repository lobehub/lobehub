import { ThreadStatus, ThreadType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { ChatStoreState } from '@/store/chat';

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
});
