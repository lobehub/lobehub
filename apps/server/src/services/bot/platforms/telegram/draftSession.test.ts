import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearTelegramDraftSession,
  getTelegramDraftSession,
  requestTelegramDraftStop,
  resetTelegramDraftSessionsForTest,
  saveTelegramDraftSession,
  setTelegramDraftOperation,
} from './draftSession';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

const session = {
  applicationId: 'bot-1',
  draftId: 42,
  platformThreadId: 'telegram:7',
  userId: 'user-1',
};

describe('Telegram draft session', () => {
  beforeEach(() => {
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
});
