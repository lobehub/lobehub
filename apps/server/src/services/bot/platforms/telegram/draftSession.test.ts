import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimTelegramDraftCompletion,
  clearTelegramDraftSession,
  completeTelegramDraftSession,
  getTelegramDraftSession,
  markTelegramDraftDelivered,
  releaseTelegramDraftCompletion,
  requestTelegramDraftStop,
  resetTelegramDraftSessionsForTest,
  saveTelegramDraftSession,
  setTelegramDraftOperation,
  updateActiveTelegramDraftSession,
} from './draftSession';

const getRedisMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: getRedisMock,
}));

const session = {
  applicationId: 'bot-1',
  content: 'Thinking…',
  draftId: 42,
  platformThreadId: 'telegram:7',
  userId: 'user-1',
};

describe('Telegram draft session', () => {
  beforeEach(() => {
    getRedisMock.mockReturnValue(null);
    resetTelegramDraftSessionsForTest();
  });

  it('persists operation state and reports an early stop request', async () => {
    await saveTelegramDraftSession(session);
    await requestTelegramDraftStop('bot-1', 'telegram:7', 42);

    await expect(setTelegramDraftOperation('bot-1', 'telegram:7', 42, 'op-1')).resolves.toBe(true);
    await expect(getTelegramDraftSession('bot-1', 'telegram:7', 42)).resolves.toMatchObject({
      operationId: 'op-1',
      stopRequested: true,
    });
  });

  it('requires the exact bot, thread, and draft scope', async () => {
    await saveTelegramDraftSession(session);

    await expect(requestTelegramDraftStop('bot-2', 'telegram:7', 42)).resolves.toBeUndefined();
    await expect(requestTelegramDraftStop('bot-1', 'telegram:8', 42)).resolves.toBeUndefined();
    await expect(requestTelegramDraftStop('bot-1', 'telegram:7', 43)).resolves.toBeUndefined();
  });

  it('clears completed draft state', async () => {
    await saveTelegramDraftSession(session);
    await clearTelegramDraftSession('bot-1', 'telegram:7', 42);

    await expect(getTelegramDraftSession('bot-1', 'telegram:7', 42)).resolves.toBeUndefined();
  });

  it('keeps a completion tombstone and rejects late draft updates in memory', async () => {
    const update = vi.fn().mockResolvedValue('Late update');
    await saveTelegramDraftSession(session);
    await completeTelegramDraftSession('bot-1', 'telegram:7', 42);

    await expect(updateActiveTelegramDraftSession('bot-1', 'telegram:7', 42, update)).resolves.toBe(
      false,
    );
    expect(update).not.toHaveBeenCalled();
    await expect(getTelegramDraftSession('bot-1', 'telegram:7', 42)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('allows one in-memory completion claim and can release it', async () => {
    await saveTelegramDraftSession(session);
    const claimed = await claimTelegramDraftCompletion('bot-1', 'telegram:7', 42);
    expect(claimed).toMatchObject({ owner: expect.any(String), status: 'claimed' });
    if (claimed.status !== 'claimed') throw new Error('expected a claimed owner');

    await expect(claimTelegramDraftCompletion('bot-1', 'telegram:7', 42)).resolves.toEqual({
      status: 'busy',
    });
    await releaseTelegramDraftCompletion('bot-1', 'telegram:7', 42, claimed.owner);
    await expect(claimTelegramDraftCompletion('bot-1', 'telegram:7', 42)).resolves.toMatchObject({
      status: 'claimed',
    });
  });

  it('distinguishes a missing draft so completion delivery can fail closed', async () => {
    await expect(claimTelegramDraftCompletion('bot-1', 'telegram:7', 42)).resolves.toEqual({
      status: 'missing',
    });
  });

  it('lets a later worker finalize an in-memory delivered draft', async () => {
    await saveTelegramDraftSession(session);
    const claimed = await claimTelegramDraftCompletion('bot-1', 'telegram:7', 42);
    if (claimed.status !== 'claimed') throw new Error('expected a claimed owner');

    await expect(
      markTelegramDraftDelivered('bot-1', 'telegram:7', 42, claimed.owner),
    ).resolves.toBe(true);
    await expect(claimTelegramDraftCompletion('bot-1', 'telegram:7', 42)).resolves.toEqual({
      status: 'finalize',
    });
    await expect(completeTelegramDraftSession('bot-1', 'telegram:7', 42)).resolves.toBe(true);
  });

  it('falls back to memory when Redis cannot persist a draft session', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('redis down')),
      get: vi.fn().mockResolvedValue(null),
    };
    getRedisMock.mockReturnValue(redis);

    await saveTelegramDraftSession(session);
    await expect(getTelegramDraftSession('bot-1', 'telegram:7', 42)).resolves.toMatchObject({
      content: 'Thinking…',
    });
  });

  it('fails closed when durable draft storage is unavailable', async () => {
    getRedisMock.mockReturnValue(null);

    await expect(saveTelegramDraftSession(session, true)).resolves.toBe(false);
    await expect(getTelegramDraftSession('bot-1', 'telegram:7', 42)).resolves.toBeUndefined();
  });

  it('uses a preset Redis claim boundary result without interpreting Lua', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValueOnce('{}').mockResolvedValueOnce(0),
      get: vi.fn().mockResolvedValue(null),
    };
    getRedisMock.mockReturnValue(redis);
    await saveTelegramDraftSession(session);

    await expect(claimTelegramDraftCompletion('bot-1', 'telegram:7', 42)).resolves.toEqual({
      status: 'busy',
    });
  });

  it('records Stop in memory when Redis writes fail', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValueOnce('{}').mockRejectedValueOnce(new Error('redis down')),
      get: vi.fn().mockResolvedValue(null),
    };
    getRedisMock.mockReturnValue(redis);
    await saveTelegramDraftSession(session);

    await expect(requestTelegramDraftStop('bot-1', 'telegram:7', 42)).resolves.toMatchObject({
      stopRequested: true,
    });
  });
});
