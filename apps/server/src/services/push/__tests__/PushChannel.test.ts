import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PushChannel } from '../PushChannel';
import type { PushDeliveryContext, PushTicketRecord } from '../types';

const mockListByUserId = vi.fn();
const mockDeleteByTokens = vi.fn();
const { mockLog } = vi.hoisted(() => ({ mockLog: vi.fn() }));

vi.mock('debug', () => ({ default: () => mockLog }));

vi.mock('@/database/models/pushToken', () => ({
  PushTokenModel: vi.fn(function () {
    return {
      deleteByTokens: mockDeleteByTokens,
      listByUserId: mockListByUserId,
    };
  }),
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

  it('excludes only devices already delivered through another system surface', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'activitykit-success', expoToken: 'ExponentPushToken[A]' },
      { deviceId: 'activitykit-failed', expoToken: 'ExponentPushToken[B]' },
      { deviceId: 'android-fallback', expoToken: 'ExponentPushToken[C]' },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      { id: 'ticket-2', status: 'ok' },
      { id: 'ticket-3', status: 'ok' },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver({
      ...ctx,
      pushPresentation: { excludeDeviceIds: ['activitykit-success'] },
    });

    expect(result.status).toBe('sent');
    expect(
      expo.sendPushNotificationsAsync.mock.calls[0][0].map((message: any) => message.to),
    ).toEqual(['ExponentPushToken[B]', 'ExponentPushToken[C]']);
  });

  it('does not call Expo when every registered device was explicitly excluded', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'iphone', expoToken: 'ExponentPushToken[A]' },
    ]);

    const expo = makeExpoMock();
    const channel = new PushChannel(expo as any);
    const result = await channel.deliver({
      ...ctx,
      pushPresentation: { excludeDeviceIds: ['iphone'] },
    });

    expect(result).toEqual({ status: 'delivered' });
    expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('adds mutable content, image, and custom data for a rich agent notification', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'iphone', expoToken: 'ExponentPushToken[A]' },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([{ id: 'ticket-1', status: 'ok' }]);

    const channel = new PushChannel(expo as any);
    await channel.deliver({
      ...ctx,
      pushPresentation: {
        data: {
          agentAvatar: '🤖',
          agentAvatarBackgroundColor: '#ff0000',
          agentId: 'agt_1',
          lobePushStyle: 'agent_message',
          notificationId: 'spoofed-notification',
          type: 'spoofed_type',
          url: '/malicious-target',
        },
        image: 'https://example.com/avatar.png',
        mutableContent: true,
      },
      type: 'agent_run_completed',
    });

    expect(expo.sendPushNotificationsAsync.mock.calls[0][0][0]).toMatchObject({
      data: {
        agentAvatar: '🤖',
        agentAvatarBackgroundColor: '#ff0000',
        agentId: 'agt_1',
        lobePushStyle: 'agent_message',
        notificationId: 'notif-1',
        type: 'agent_run_completed',
        url: '/image?topic=t1',
      },
      mutableContent: true,
      richContent: { image: 'https://example.com/avatar.png' },
    });
  });

  it('preserves an absolute review URL without logging its credential', async () => {
    const reviewToken = 'A'.repeat(43);
    const reviewUrl = `https://app.lobehub.com/agent-approval?reviewToken=${reviewToken}`;
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'iphone', expoToken: 'ExponentPushToken[A]' },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([{ id: 'ticket-1', status: 'ok' }]);

    const channel = new PushChannel(expo as any);
    await channel.deliver({ ...ctx, actionUrl: reviewUrl });

    expect(expo.sendPushNotificationsAsync.mock.calls[0][0][0].data.url).toBe(reviewUrl);
    expect(JSON.stringify(mockLog.mock.calls)).not.toContain(reviewToken);
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
        // Provider-owned messages are untrusted and may echo the credential.
        message: 'ExponentPushToken[B]',
        status: 'error',
      },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result.status).toBe('sent');
    const records = JSON.parse(result.providerMessageId!) as PushTicketRecord[];
    expect(records).toEqual([{ expoToken: 'ExponentPushToken[A]', ticketId: 'ticket-1' }]);
    expect(mockLog).toHaveBeenCalledWith(
      'Send-time error for deviceId=%s category=%s',
      'b',
      'DeviceNotRegistered',
    );
    expect(JSON.stringify(mockLog.mock.calls)).not.toContain('ExponentPushToken[B]');
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

  describe('native APNs tokens', () => {
    const apnsToken = 'ab'.repeat(32);
    const deadToken = 'cd'.repeat(32);
    const makeApnsMock = () => ({ send: vi.fn().mockResolvedValue({ status: 'ok' }) });

    it('sends APNs tokens directly to APNs and Expo tokens to Expo', async () => {
      mockListByUserId.mockResolvedValueOnce([
        {
          apnsEnvironment: 'sandbox',
          bundleId: 'com.lobehub.lobot',
          deviceId: 'native-iphone',
          expoToken: apnsToken,
          provider: 'apns',
        },
        { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]', provider: 'expo' },
      ]);
      const expo = makeExpoMock();
      expo.sendPushNotificationsAsync.mockResolvedValueOnce([{ id: 'ticket-1', status: 'ok' }]);
      const apns = makeApnsMock();

      const result = await new PushChannel(expo as any, apns as any).deliver({
        ...ctx,
        pushPresentation: {
          data: { agentId: 'agt_1', url: '/malicious-target' },
          image: 'https://example.com/avatar.png',
          mutableContent: true,
        },
        type: 'agent_run_completed',
      });

      // Expo tickets still drive the receipt cron.
      expect(result.status).toBe('sent');
      expect(JSON.parse(result.providerMessageId!)).toEqual([
        { expoToken: 'ExponentPushToken[B]', ticketId: 'ticket-1' },
      ]);
      expect(
        expo.sendPushNotificationsAsync.mock.calls[0][0].map((message: any) => message.to),
      ).toEqual(['ExponentPushToken[B]']);

      expect(apns.send).toHaveBeenCalledTimes(1);
      expect(apns.send).toHaveBeenCalledWith({
        environment: 'sandbox',
        payload: {
          agentId: 'agt_1',
          aps: {
            'alert': { body: ctx.content, title: ctx.title },
            'mutable-content': 1,
            'sound': 'default',
          },
          image: 'https://example.com/avatar.png',
          notificationId: 'notif-1',
          type: 'agent_run_completed',
          url: '/image?topic=t1',
        },
        token: apnsToken,
        topic: 'com.lobehub.lobot',
      });
    });

    it('reports delivered when only APNs tokens were sent, since APNs has no receipts', async () => {
      mockListByUserId.mockResolvedValueOnce([
        {
          apnsEnvironment: null,
          bundleId: null,
          deviceId: 'a',
          expoToken: apnsToken,
          provider: 'apns',
        },
      ]);
      const expo = makeExpoMock();
      const apns = makeApnsMock();

      const result = await new PushChannel(expo as any, apns as any).deliver(ctx);

      expect(result).toEqual({ status: 'delivered' });
      expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
      expect(apns.send).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'production', topic: undefined }),
      );
    });

    it('removes tokens APNs reports as BadDeviceToken or Unregistered, and keeps the rest', async () => {
      const otherDead = 'ef'.repeat(32);
      const throttled = '12'.repeat(32);
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'ok', expoToken: apnsToken, provider: 'apns' },
        { deviceId: 'gone', expoToken: deadToken, provider: 'apns' },
        { deviceId: 'bad', expoToken: otherDead, provider: 'apns' },
        { deviceId: 'busy', expoToken: throttled, provider: 'apns' },
      ]);
      const apns = {
        send: vi.fn(async ({ token }: { token: string }) => {
          if (token === deadToken)
            return { reason: 'Unregistered', status: 'error', statusCode: 410 };
          if (token === otherDead)
            return { reason: 'BadDeviceToken', status: 'error', statusCode: 400 };
          if (token === throttled)
            return { reason: 'TooManyRequests', status: 'error', statusCode: 429 };
          return { status: 'ok' };
        }),
      };

      const result = await new PushChannel(makeExpoMock() as any, apns as any).deliver(ctx);

      expect(result).toEqual({ status: 'delivered' });
      expect(mockDeleteByTokens).toHaveBeenCalledTimes(1);
      expect(mockDeleteByTokens).toHaveBeenCalledWith('apns', [deadToken, otherDead]);
      expect(JSON.stringify(mockLog.mock.calls)).not.toContain(deadToken);
    });

    it('fails with all_send_failed when APNs rejects every token or the request throws', async () => {
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'gone', expoToken: deadToken, provider: 'apns' },
        { deviceId: 'offline', expoToken: apnsToken, provider: 'apns' },
      ]);
      const apns = {
        send: vi
          .fn()
          .mockResolvedValueOnce({ reason: 'Unregistered', status: 'error', statusCode: 410 })
          .mockRejectedValueOnce(new Error('socket hang up')),
      };

      const result = await new PushChannel(makeExpoMock() as any, apns as any).deliver(ctx);

      expect(result).toEqual({ failedReason: 'all_send_failed', status: 'failed' });
      expect(mockDeleteByTokens).toHaveBeenCalledWith('apns', [deadToken]);
    });

    it('skips APNs tokens with a log when APNs is not configured', async () => {
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'native', expoToken: apnsToken, provider: 'apns' },
        { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]', provider: 'expo' },
      ]);
      const expo = makeExpoMock();
      expo.sendPushNotificationsAsync.mockResolvedValueOnce([{ id: 'ticket-1', status: 'ok' }]);

      const result = await new PushChannel(expo as any, null).deliver(ctx);

      expect(result.status).toBe('sent');
      expect(
        expo.sendPushNotificationsAsync.mock.calls[0][0].map((message: any) => message.to),
      ).toEqual(['ExponentPushToken[B]']);
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('APNs not configured'),
        1,
        'user-1',
      );
      expect(mockDeleteByTokens).not.toHaveBeenCalled();
    });

    it('returns apns_not_configured when only APNs tokens exist and APNs is not configured', async () => {
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'native', expoToken: apnsToken, provider: 'apns' },
      ]);
      const expo = makeExpoMock();

      const result = await new PushChannel(expo as any, null).deliver(ctx);

      expect(result).toEqual({ failedReason: 'apns_not_configured', status: 'failed' });
      expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('still delivers to APNs when the Expo leg is rate limited', async () => {
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'native', expoToken: apnsToken, provider: 'apns' },
        { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]', provider: 'expo' },
      ]);
      const expo = makeExpoMock();
      expo.sendPushNotificationsAsync.mockRejectedValueOnce(
        Object.assign(new Error('rate'), { statusCode: 429 }),
      );
      const apns = makeApnsMock();

      const result = await new PushChannel(expo as any, apns as any).deliver(ctx);

      // An Expo project-level rate limit must not suppress the native leg.
      expect(apns.send).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'delivered' });
    });

    it('still delivers to APNs when the Expo leg throws, and rethrows if nothing was delivered', async () => {
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'native', expoToken: apnsToken, provider: 'apns' },
        { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]', provider: 'expo' },
      ]);
      const expo = makeExpoMock();
      expo.sendPushNotificationsAsync.mockRejectedValueOnce(new Error('network down'));
      const apns = makeApnsMock();

      const result = await new PushChannel(expo as any, apns as any).deliver(ctx);

      expect(apns.send).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'delivered' });
    });

    /** The Expo leg's error must still surface when no provider delivered anything. */
    it('rethrows the Expo error when the APNs leg also delivers nothing', async () => {
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'native', expoToken: apnsToken, provider: 'apns' },
        { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]', provider: 'expo' },
      ]);
      const expo = makeExpoMock();
      expo.sendPushNotificationsAsync.mockRejectedValueOnce(new Error('network down'));
      const apns = { send: vi.fn().mockRejectedValue(new Error('socket hang up')) };

      await expect(new PushChannel(expo as any, apns as any).deliver(ctx)).rejects.toThrow(
        'network down',
      );
    });

    it('honours excluded devices for APNs tokens too', async () => {
      mockListByUserId.mockResolvedValueOnce([
        { deviceId: 'native', expoToken: apnsToken, provider: 'apns' },
      ]);
      const apns = makeApnsMock();

      const result = await new PushChannel(makeExpoMock() as any, apns as any).deliver({
        ...ctx,
        pushPresentation: { excludeDeviceIds: ['native'] },
      });

      expect(result).toEqual({ status: 'delivered' });
      expect(apns.send).not.toHaveBeenCalled();
    });
  });
});
