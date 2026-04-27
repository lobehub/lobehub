// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext } from '@/libs/trpc/lambda/context';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { agentSignalRouter } from './agentSignal';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/server/services/agentSignal', () => ({
  enqueueAgentSignalSourceEvent: vi
    .fn()
    .mockResolvedValue({ accepted: true, scopeKey: 'topic:topic-1', workflowRunId: 'wfr_1' }),
}));

const createCaller = createCallerFactory(agentSignalRouter);

describe('agentSignalRouter', () => {
  let ctx: AuthContext;
  let router: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createContextInner({ userId: 'user-1' });
    router = createCaller(ctx);
  });

  it('accepts client runtime events', async () => {
    await expect(
      router.emitSourceEvent({
        payload: {
          agentId: 'agent-1',
          operationId: 'op-1',
          parentMessageId: 'msg-1',
          parentMessageType: 'user',
          threadId: 'thread-1',
          topicId: 'topic-1',
        },
        sourceId: 'op-1:client:start',
        sourceType: 'client.runtime.start',
      }),
    ).resolves.toEqual({ accepted: true, scopeKey: 'topic:topic-1', workflowRunId: 'wfr_1' });
  });

  it('rejects forged non-client source events', async () => {
    await expect(
      router.emitSourceEvent({
        payload: {
          message: 'remember this',
          messageId: 'msg-1',
          topicId: 'topic-1',
        },
        sourceId: 'msg-1',
        sourceType: 'agent.user.message' as never,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
