import { signCallback } from '@lobechat/chat-adapter-dingtalk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const botReply = vi.hoisted(() => ({ rememberDingTalkSessionWebhook: vi.fn() }));
vi.mock('@/server/services/redis', () => ({ redisService: { botReply } }));

const { captureSessionWebhook, isDingTalkSessionWebhookUrl, withSessionWebhookCapture } =
  await import('./sessionWebhook');

const SECRET = 'client-secret';
const EXPIRES = Date.now() + 60 * 60 * 1000;

const payload = (overrides: Record<string, unknown> = {}) => ({
  conversationId: 'cidGroup==',
  conversationType: '2',
  msgId: 'm1',
  msgtype: 'text',
  senderId: '$:LWCP_v1:$user',
  senderStaffId: 'staff1',
  sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=s1',
  sessionWebhookExpiredTime: EXPIRES,
  text: { content: 'hi' },
  ...overrides,
});

const signedRequest = (body: unknown, secret = SECRET) => {
  const timestamp = String(Date.now());
  return new Request('https://app.example.com/api/agent/webhooks/dingtalk/dingapp', {
    body: JSON.stringify(body),
    headers: { sign: signCallback(timestamp, secret), timestamp },
    method: 'POST',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('captureSessionWebhook', () => {
  it('stores a group route keyed by the adapter thread id', async () => {
    await captureSessionWebhook(signedRequest(payload()), 'dingapp', SECRET);

    expect(botReply.rememberDingTalkSessionWebhook).toHaveBeenCalledWith(
      'dingapp',
      'dingtalk:group:cidGroup==',
      { expiresAt: EXPIRES, url: 'https://oapi.dingtalk.com/robot/sendBySession?session=s1' },
    );
  });

  it('keys a single chat by staff id, or by sender id for external contacts', async () => {
    await captureSessionWebhook(
      signedRequest(payload({ conversationType: '1' })),
      'dingapp',
      SECRET,
    );
    await captureSessionWebhook(
      signedRequest(payload({ conversationType: '1', senderStaffId: undefined })),
      'dingapp',
      SECRET,
    );

    expect(
      botReply.rememberDingTalkSessionWebhook.mock.calls.map(([, threadId]) => threadId),
    ).toEqual(['dingtalk:single:staff1', 'dingtalk:single:$:LWCP_v1:$user']);
  });

  it('never stores a route from an unsigned or wrongly signed request', async () => {
    await captureSessionWebhook(signedRequest(payload(), 'other-secret'), 'dingapp', SECRET);
    await captureSessionWebhook(
      new Request('https://x', { body: JSON.stringify(payload()), method: 'POST' }),
      'dingapp',
      SECRET,
    );

    expect(botReply.rememberDingTalkSessionWebhook).not.toHaveBeenCalled();
  });

  it('ignores a route outside dingtalk.com', async () => {
    await captureSessionWebhook(
      signedRequest(payload({ sessionWebhook: 'https://evil.example/hook' })),
      'dingapp',
      SECRET,
    );
    expect(botReply.rememberDingTalkSessionWebhook).not.toHaveBeenCalled();
  });
});

describe('isDingTalkSessionWebhookUrl', () => {
  it.each([
    ['https://oapi.dingtalk.com/robot/sendBySession?session=1', true],
    ['https://api.dingtalk.com/x', true],
    ['http://oapi.dingtalk.com/x', false],
    ['https://dingtalk.com.evil.example/x', false],
    ['https://evildingtalk.com/x', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isDingTalkSessionWebhookUrl(url)).toBe(expected);
  });
});

describe('withSessionWebhookCapture', () => {
  it('captures the route and still hands the untouched request to the adapter', async () => {
    const handleWebhook = vi.fn(async (request: Request) => {
      expect(JSON.parse(await request.text())).toMatchObject({ msgId: 'm1' });
      return Response.json({ ok: true });
    });
    const adapter = withSessionWebhookCapture({ handleWebhook } as any, 'dingapp', SECRET);

    const response = await adapter.handleWebhook(signedRequest(payload()));

    expect(response.status).toBe(200);
    expect(handleWebhook).toHaveBeenCalledTimes(1);
    expect(botReply.rememberDingTalkSessionWebhook).toHaveBeenCalledTimes(1);
  });

  it('does not block the callback when Redis fails', async () => {
    botReply.rememberDingTalkSessionWebhook.mockRejectedValueOnce(new Error('redis down'));
    const handleWebhook = vi.fn(async () => Response.json({ ok: true }));
    const adapter = withSessionWebhookCapture({ handleWebhook } as any, 'dingapp', SECRET);

    await expect(adapter.handleWebhook(signedRequest(payload()))).resolves.toBeInstanceOf(Response);
    expect(handleWebhook).toHaveBeenCalled();
  });
});
