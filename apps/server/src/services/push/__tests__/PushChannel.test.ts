import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PushChannel } from '../PushChannel';
import type { PushDeliveryContext, PushTicketRecord } from '../types';

const mockListByUserId = vi.fn();

vi.mock('@/database/models/pushToken', () => ({
  PushTokenModel: vi.fn(() => ({
    listByUserId: mockListByUserId,
  })),
}));

vi.mock('@/database/server', () => ({ serverDB: {} }));

const ctx: PushDeliveryContext = {
  actionUrl: '/image?topic=t1',
  content: 'Your image is ready.',
  notificationId: 'notif-1',
  title: 'Image Generated',
  userId: 'user-1',
};

const makeExpoMock = (overrides: Partial<any> = {}) => ({
  chunkPushNotifications: (msgs: any[]) => [msgs],
  chunkPushNotificationReceiptIds: (ids: string[]) => [ids],
  isExpoPushToken: (t: string) => t.startsWith('ExponentPushToken['),
  sendPushNotificationsAsync: vi.fn(),
  ...overrides,
});

describe('PushChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no_tokens when the user has no push_tokens row', async () => {
    mockListByUserId.mockResolvedValueOnce([]);

    const expo = makeExpoMock();
    const channel = new PushChannel(expo as any);

    const result = await channel.deliver(ctx);

    expect(result).toEqual({ failedReason: 'no_tokens', status: 'failed' });
    expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('returns invalid_tokens when all stored tokens are malformed', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'a', expoToken: 'not-a-real-token' },
      { deviceId: 'b', expoToken: 'also-bad' },
    ]);

    const expo = makeExpoMock({
      isExpoPushToken: () => false,
    });
    const channel = new PushChannel(expo as any);

    const result = await channel.deliver(ctx);
    expect(result.status).toBe('failed');
    expect(result.failedReason).toBe('invalid_tokens');
  });

  it('sends one Expo message per token and embeds ticket→token mapping', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'iphone', expoToken: 'ExponentPushToken[A]' },
      { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]' },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      { id: 'ticket-1', status: 'ok' },
      { id: 'ticket-2', status: 'ok' },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result.status).toBe('sent');
    const records = JSON.parse(result.providerMessageId!) as PushTicketRecord[];
    expect(records).toEqual([
      { expoToken: 'ExponentPushToken[A]', ticketId: 'ticket-1' },
      { expoToken: 'ExponentPushToken[B]', ticketId: 'ticket-2' },
    ]);

    const sentMessages = expo.sendPushNotificationsAsync.mock.calls[0][0];
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toMatchObject({
      body: ctx.content,
      channelId: 'default',
      data: { notificationId: 'notif-1', url: '/image?topic=t1' },
      priority: 'high',
      sound: 'default',
      title: ctx.title,
      to: 'ExponentPushToken[A]',
    });
  });

  it('drops send-time errors but still returns sent if at least one ticket succeeded', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'a', expoToken: 'ExponentPushToken[A]' },
      { deviceId: 'b', expoToken: 'ExponentPushToken[B]' },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      { id: 'ticket-1', status: 'ok' },
      {
        details: { error: 'DeviceNotRegistered' },
        message: 'token-b dead',
        status: 'error',
      },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result.status).toBe('sent');
    const records = JSON.parse(result.providerMessageId!) as PushTicketRecord[];
    expect(records).toEqual([{ expoToken: 'ExponentPushToken[A]', ticketId: 'ticket-1' }]);
  });

  it('returns all_send_failed when every ticket fails at send time', async () => {
    mockListByUserId.mockResolvedValueOnce([{ deviceId: 'a', expoToken: 'ExponentPushToken[A]' }]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      {
        details: { error: 'DeviceNotRegistered' },
        message: 'dead',
        status: 'error',
      },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result.status).toBe('failed');
    expect(result.failedReason).toBe('all_send_failed');
  });

  it('returns rate_limited on 429 without throwing', async () => {
    mockListByUserId.mockResolvedValueOnce([{ deviceId: 'a', expoToken: 'ExponentPushToken[A]' }]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockRejectedValueOnce(
      Object.assign(new Error('rate'), { statusCode: 429 }),
    );

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result).toEqual({ failedReason: 'rate_limited', status: 'failed' });
  });

  it('rethrows non-429 send errors so NotificationService can log', async () => {
    mockListByUserId.mockResolvedValueOnce([{ deviceId: 'a', expoToken: 'ExponentPushToken[A]' }]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockRejectedValueOnce(new Error('network down'));

    const channel = new PushChannel(expo as any);
    await expect(channel.deliver(ctx)).rejects.toThrow('network down');
  });
});
