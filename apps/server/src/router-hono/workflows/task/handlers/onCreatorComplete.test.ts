import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onCreatorComplete } from './onCreatorComplete';

const {
  areDelivered,
  completeCreatorWakeup,
  getDeliveredChunkCount,
  getServerDB,
  handleCallback,
  markDeliveryChunk,
} = vi.hoisted(() => ({
  areDelivered: vi.fn(),
  completeCreatorWakeup: vi.fn(),
  getDeliveredChunkCount: vi.fn(),
  getServerDB: vi.fn(),
  handleCallback: vi.fn(),
  markDeliveryChunk: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB }));
vi.mock('@/server/services/bot/BotCallbackService', () => ({
  BotCallbackService: vi.fn(() => ({ handleCallback })),
}));
vi.mock('@/server/services/taskResultBridge', () => ({
  TaskResultBridgeService: vi.fn(() => ({ completeCreatorWakeup })),
}));
vi.mock('@/server/services/taskResultBridge/redisStore', () => ({
  TaskResultCallbackRedisStore: vi.fn(() => ({
    areDelivered,
    getDeliveredChunkCount,
    markDeliveryChunk,
  })),
}));

const makeContext = (body: Record<string, unknown>) => {
  const json = vi.fn((payload, status = 200) => ({ payload, status }));
  return {
    context: { json, req: { json: vi.fn().mockResolvedValue(body) } } as any,
    json,
  };
};

const payload = {
  agentId: 'agent-creator',
  applicationId: 'messenger-discord',
  lastAssistantContent: 'The task result is ready.',
  operationId: 'op-creator',
  originTopicId: 'topic-origin',
  platformThreadId: 'discord:guild:channel:thread',
  reason: 'done',
  receiptIds: ['receipt-1'],
  userId: 'user-1',
};

describe('onCreatorComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerDB.mockResolvedValue({});
    handleCallback.mockResolvedValue(undefined);
    completeCreatorWakeup.mockResolvedValue(undefined);
    areDelivered.mockResolvedValue(false);
    getDeliveredChunkCount.mockResolvedValue(1);
    markDeliveryChunk.mockResolvedValue(undefined);
  });

  it('delivers to Messenger before settling the callback receipt', async () => {
    const { context } = makeContext(payload);

    const response = await onCreatorComplete(context);

    expect(response).toMatchObject({ status: 200 });
    expect(handleCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        lastAssistantContent: 'The task result is ready.',
        platformThreadId: 'discord:guild:channel:thread',
        type: 'completion',
      }),
      expect.objectContaining({ deliveredChunkCount: 1, strictDelivery: true }),
    );
    expect(handleCallback.mock.invocationCallOrder[0]).toBeLessThan(
      completeCreatorWakeup.mock.invocationCallOrder[0],
    );
  });

  it('keeps the receipt processing when Messenger delivery fails', async () => {
    handleCallback.mockRejectedValue(new Error('Discord unavailable'));
    const { context } = makeContext(payload);

    const response = await onCreatorComplete(context);

    expect(response).toMatchObject({ status: 500 });
    expect(completeCreatorWakeup).not.toHaveBeenCalled();
  });

  it('does not redeliver Messenger output after the receipt was settled', async () => {
    areDelivered.mockResolvedValue(true);
    const { context } = makeContext(payload);

    const response = await onCreatorComplete(context);

    expect(response).toMatchObject({ payload: { deduped: true, success: true }, status: 200 });
    expect(handleCallback).not.toHaveBeenCalled();
    expect(completeCreatorWakeup).not.toHaveBeenCalled();
  });
});
