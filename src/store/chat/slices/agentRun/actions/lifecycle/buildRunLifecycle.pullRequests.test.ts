import type { ConversationContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import { messageMapKey } from '../../../../utils/messageMapKey';
import { buildRunLifecycle } from './buildRunLifecycle';

const mocks = vi.hoisted(() => ({
  linkOwnBranchPullRequest: vi.fn(async () => {}),
  refreshTopicPullRequests: vi.fn(async () => {}),
}));

vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/linkOwnBranchPullRequest', () => ({
  linkOwnBranchPullRequest: mocks.linkOwnBranchPullRequest,
}));
vi.mock('@/services/work', () => ({
  workService: { refreshTopicPullRequests: mocks.refreshTopicPullRequests },
}));
vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

const OP = 'op1';
const CONTEXT = { agentId: 'a1', topicId: 't1' } as ConversationContext;

const makeStore = (queued: boolean) => {
  const store = {
    activeAgentId: 'a1',
    activeTopicId: 't1',
    completeOperation: vi.fn(),
    dbMessagesMap: {},
    drainQueuedMessages: vi.fn(() => (queued ? [{ content: 'next', id: 'q1' }] : [])),
    failOperation: vi.fn(),
    markTopicUnread: vi.fn(),
    messagesMap: {},
    operations: { [OP]: { context: CONTEXT, id: OP, metadata: {}, status: 'running' } },
    operationsByContext: { [messageMapKey(CONTEXT)]: [OP] },
    queuedMessages: queued ? { [messageMapKey(CONTEXT)]: [{ content: 'next', id: 'q1' }] } : {},
    sendMessage: vi.fn().mockResolvedValue(undefined),
    topicDataMap: {},
    updateOperationMetadata: vi.fn(),
    updateTopicStatus: vi.fn(async () => {}),
  };
  return (() => store) as unknown as () => ChatStore;
};

const complete = (get: () => ChatStore, runtimeStatus: 'done' | 'error' = 'done') =>
  buildRunLifecycle(get, {
    context: CONTEXT,
    parentMessageId: 'u1',
    parentMessageType: 'user',
    runId: OP,
    runScope: 'top_level',
    runtimeType: 'client',
  }).completeRun({
    context: CONTEXT,
    operationId: OP,
    runId: OP,
    runScope: 'top_level',
    runtimeStatus,
    runtimeType: 'client',
  });

describe('buildRunLifecycle.completeRun — topic pull requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up the own-branch PR even when a queued follow-up takes over', async () => {
    const { requeued } = await complete(makeStore(true));

    expect(requeued).toBe(true);
    expect(mocks.refreshTopicPullRequests).toHaveBeenCalledWith('t1');
    expect(mocks.linkOwnBranchPullRequest).toHaveBeenCalledWith(expect.any(Function), {
      agentId: 'a1',
      topicId: 't1',
    });
  });

  it('skips the lookup for a failed run', async () => {
    await complete(makeStore(false), 'error');

    expect(mocks.linkOwnBranchPullRequest).not.toHaveBeenCalled();
    expect(mocks.refreshTopicPullRequests).toHaveBeenCalledTimes(1);
  });
});
