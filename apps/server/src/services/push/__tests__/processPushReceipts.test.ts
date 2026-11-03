import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processPushReceipts } from '../processPushReceipts';

const mockDeleteByExpoTokens = vi.fn();

vi.mock('@/database/models/pushToken', () => ({
  deletePushTokensByExpoTokens: (...args: unknown[]) => mockDeleteByExpoTokens(...args),
}));

vi.mock('@/database/schemas/notification', () => ({
  notificationDeliveries: {
    channel: { name: 'channel' },
    id: { name: 'id' },
    sentAt: { name: 'sent_at' },
    status: { name: 'status' },
  },
}));

/**
 * Minimal fake db that records `.update().set().where()` chains and lets
 * us inspect what processPushReceipts attempted to write.
 */
function fakeDb(pendingRows: any[]) {
  const updates: Array<{ set: any }> = [];

  const db = {
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(pendingRows),
      }),
    })),
    update: vi.fn(() => ({
      set: (s: any) => {
        updates.push({ set: s });
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    })),
  };

  return { db, updates };
}

function fakeExpo(receipts: Record<string, any>) {
  return {
    chunkPushNotificationReceiptIds: (ids: string[]) => [ids],
    getPushNotificationReceiptsAsync: vi.fn().mockResolvedValue(receipts),
  };
}

describe('processPushReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zeros when there are no pending deliveries', async () => {
    const { db } = fakeDb([]);
    const expo = fakeExpo({});

    const result = await processPushReceipts(db as any, { expoClient: expo as any });

    expect(result.processed).toBe(0);
    expect(expo.getPushNotificationReceiptsAsync).not.toHaveBeenCalled();
  });

  it('marks delivery as delivered when all tickets are ok', async () => {
    const { db, updates } = fakeDb([
      {
        id: 'd1',
        providerMessageId: JSON.stringify([
          { expoToken: 'ExponentPushToken[A]', ticketId: 't1' },
          { expoToken: 'ExponentPushToken[B]', ticketId: 't2' },
        ]),
      },
    ]);
    const expo = fakeExpo({
      t1: { status: 'ok' },
      t2: { status: 'ok' },
    });

    const result = await processPushReceipts(db as any, { expoClient: expo as any });

    expect(result.deliveriesUpdated).toBe(1);
    expect(updates[0].set).toEqual({ status: 'delivered' });
    expect(mockDeleteByExpoTokens).toHaveBeenCalledWith(db, []);
  });

  it('marks delivery as failed and queues tokens for deletion on DeviceNotRegistered', async () => {
    const { db, updates } = fakeDb([
      {
        id: 'd1',
        providerMessageId: JSON.stringify([
          { expoToken: 'ExponentPushToken[A]', ticketId: 't1' },
          { expoToken: 'ExponentPushToken[B]', ticketId: 't2' },
        ]),
      },
    ]);
    const expo = fakeExpo({
      t1: { details: { error: 'DeviceNotRegistered' }, message: 'gone', status: 'error' },
      t2: { status: 'ok' },
    });

    const result = await processPushReceipts(db as any, { expoClient: expo as any });

    expect(result.deliveriesUpdated).toBe(1);
    expect(result.invalidTokensDeleted).toBe(1);
    expect(updates[0].set.status).toBe('failed');
    expect(updates[0].set.failedReason).toContain('DeviceNotRegistered');
    expect(mockDeleteByExpoTokens).toHaveBeenCalledWith(db, ['ExponentPushToken[A]']);
  });

  it('aggregates distinct error reasons per delivery', async () => {
    const { db, updates } = fakeDb([
      {
        id: 'd1',
        providerMessageId: JSON.stringify([
          { expoToken: 'ExponentPushToken[A]', ticketId: 't1' },
          { expoToken: 'ExponentPushToken[B]', ticketId: 't2' },
        ]),
      },
    ]);
    const expo = fakeExpo({
      t1: { details: { error: 'DeviceNotRegistered' }, status: 'error' },
      t2: { details: { error: 'MessageRateExceeded' }, status: 'error' },
    });

    await processPushReceipts(db as any, { expoClient: expo as any });

    expect(updates[0].set.failedReason).toBe('DeviceNotRegistered,MessageRateExceeded');
  });

  it('leaves delivery in sent state when Expo has not returned any receipts yet', async () => {
    const { db, updates } = fakeDb([
      {
        id: 'd1',
        providerMessageId: JSON.stringify([{ expoToken: 'ExponentPushToken[A]', ticketId: 't1' }]),
      },
    ]);
    // No receipts available yet
    const expo = fakeExpo({});

    const result = await processPushReceipts(db as any, { expoClient: expo as any });

    expect(result.deliveriesUpdated).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('leaves delivery in sent state when only some tickets have receipts', async () => {
    // Two tickets, only t1 has a receipt. We must NOT finalize the delivery
    // as 'delivered' — t2 might come back as DeviceNotRegistered later, and
    // skipping reconciliation would leak the invalid token.
    const { db, updates } = fakeDb([
      {
        id: 'd1',
        providerMessageId: JSON.stringify([
          { expoToken: 'ExponentPushToken[A]', ticketId: 't1' },
          { expoToken: 'ExponentPushToken[B]', ticketId: 't2' },
        ]),
      },
    ]);
    const expo = fakeExpo({ t1: { status: 'ok' } });

    const result = await processPushReceipts(db as any, { expoClient: expo as any });

    expect(result.deliveriesUpdated).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('skips malformed providerMessageId without failing the whole run', async () => {
    const { db, updates } = fakeDb([
      { id: 'd-bad', providerMessageId: 'not-json' },
      {
        id: 'd-good',
        providerMessageId: JSON.stringify([{ expoToken: 'ExponentPushToken[A]', ticketId: 't1' }]),
      },
    ]);
    const expo = fakeExpo({ t1: { status: 'ok' } });

    const result = await processPushReceipts(db as any, { expoClient: expo as any });

    expect(result.skippedMalformed).toBe(1);
    expect(result.deliveriesUpdated).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it('dedupes invalid tokens across multiple deliveries', async () => {
    const sharedToken = 'ExponentPushToken[X]';
    const { db } = fakeDb([
      {
        id: 'd1',
        providerMessageId: JSON.stringify([{ expoToken: sharedToken, ticketId: 't1' }]),
      },
      {
        id: 'd2',
        providerMessageId: JSON.stringify([{ expoToken: sharedToken, ticketId: 't2' }]),
      },
    ]);
    const expo = fakeExpo({
      t1: { details: { error: 'DeviceNotRegistered' }, status: 'error' },
      t2: { details: { error: 'DeviceNotRegistered' }, status: 'error' },
    });

    const result = await processPushReceipts(db as any, { expoClient: expo as any });

    expect(result.invalidTokensDeleted).toBe(1);
    expect(mockDeleteByExpoTokens).toHaveBeenCalledWith(db, [sharedToken]);
  });
});
