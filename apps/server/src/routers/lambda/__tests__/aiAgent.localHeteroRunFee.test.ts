// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestTopic, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;

const { holdAgentRunFee, settleAgentRunFee } = vi.hoisted(() => ({
  holdAgentRunFee: vi.fn(),
  settleAgentRunFee: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/business/server/agent-run/runFee', () => ({ holdAgentRunFee, settleAgentRunFee }));

describe('local heterogeneous run fee', () => {
  let topicId: string;
  let userId: string;

  const caller = (workspaceId?: string) =>
    aiAgentRouter.createCaller({ jwtPayload: { userId }, userId, workspaceId } as any);

  beforeEach(async () => {
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    topicId = await createTestTopic(testDB, userId);
    holdAgentRunFee.mockResolvedValue(undefined);
    settleAgentRunFee.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, userId);
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('holds the fee of a personal run under a minted fee id', async () => {
    const { feeId } = await caller().beginLocalHeteroRunFee({ topicId });

    expect(feeId).toMatch(/^local_hetero_\d+_/);
    expect(holdAgentRunFee).toHaveBeenCalledWith({ holderId: feeId, userId });
  });

  it('refuses the run when the deployment refuses an unfunded fee', async () => {
    holdAgentRunFee.mockRejectedValue(
      new TRPCError({
        code: 'PAYMENT_REQUIRED',
        message: ChatErrorType.InsufficientBudgetForAgentRunFee,
      }),
    );

    await expect(caller().beginLocalHeteroRunFee({ topicId })).rejects.toMatchObject({
      message: ChatErrorType.InsufficientBudgetForAgentRunFee,
    });
  });

  it('exempts a Workspace run', async () => {
    await expect(caller('ws_1').beginLocalHeteroRunFee({})).resolves.toEqual({ feeId: null });
    expect(holdAgentRunFee).not.toHaveBeenCalled();
  });

  it("rejects another user's topic without holding", async () => {
    const otherUserId = await createTestUser(testDB);
    const otherTopicId = await createTestTopic(testDB, otherUserId);

    try {
      await expect(
        caller().beginLocalHeteroRunFee({ topicId: otherTopicId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(holdAgentRunFee).not.toHaveBeenCalled();
    } finally {
      await cleanupTestUser(testDB, otherUserId);
    }
  });

  it('settles with the duration measured from the fee id, not the client', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
    const { feeId } = await caller().beginLocalHeteroRunFee({ topicId });
    vi.setSystemTime(new Date('2026-11-10T00:00:45Z'));

    await caller().finishLocalHeteroRunFee({ feeId: feeId!, reason: 'interrupted' });

    expect(settleAgentRunFee).toHaveBeenCalledWith({
      durationMs: 45_000,
      operationId: feeId,
      reason: 'interrupted',
      userId,
    });
  });

  it('takes a shorter duration Desktop reports, never a longer one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
    const { feeId } = await caller().beginLocalHeteroRunFee({ topicId });
    vi.setSystemTime(new Date('2026-11-10T00:00:35Z'));

    await caller().finishLocalHeteroRunFee({
      durationMs: 28_000,
      feeId: feeId!,
      reason: 'interrupted',
    });
    await caller().finishLocalHeteroRunFee({
      durationMs: 90_000,
      feeId: feeId!,
      reason: 'interrupted',
    });

    expect(settleAgentRunFee.mock.calls.map(([args]) => args.durationMs)).toEqual([28_000, 35_000]);
  });

  it('will not settle a fee id it did not mint', async () => {
    await expect(
      caller().finishLocalHeteroRunFee({ feeId: 'op_server_run', reason: 'error' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(settleAgentRunFee).not.toHaveBeenCalled();
  });
});
