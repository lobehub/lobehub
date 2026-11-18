import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyDingTalkError,
  DINGTALK_API_BASE_URL,
  DingTalkApiClient,
  DingTalkApiError,
  truncateUtf8,
} from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const tokenResponse = (token: string, expireIn = 7200) => json({ accessToken: token, expireIn });

describe('DingTalkApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: DingTalkApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new DingTalkApiClient('ding_client', 'ding_secret');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const body = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);
  const url = (call: number) => fetchMock.mock.calls[call][0];

  describe('access token', () => {
    it('exchanges Client ID / Secret at /v1.0/oauth2/accessToken', async () => {
      fetchMock.mockResolvedValueOnce(tokenResponse('tok_1'));

      await expect(client.getAccessToken()).resolves.toBe('tok_1');
      expect(url(0)).toBe(`${DINGTALK_API_BASE_URL}/v1.0/oauth2/accessToken`);
      expect(body(0)).toEqual({ appKey: 'ding_client', appSecret: 'ding_secret' });
    });

    it('caches the token and shares one in-flight request', async () => {
      fetchMock.mockResolvedValueOnce(tokenResponse('tok_1'));

      const [a, b] = await Promise.all([client.getAccessToken(), client.getAccessToken()]);
      await client.getAccessToken();

      expect(a).toBe('tok_1');
      expect(b).toBe('tok_1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refreshes 5 minutes before expireIn', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse('tok_1', 7200))
        .mockResolvedValueOnce(tokenResponse('tok_2', 7200));

      await client.getAccessToken();
      vi.advanceTimersByTime((7200 - 300) * 1000 - 1000);
      await expect(client.getAccessToken()).resolves.toBe('tok_1');

      vi.advanceTimersByTime(2000);
      await expect(client.getAccessToken()).resolves.toBe('tok_2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('maps any 4xx from the token endpoint to an auth error', async () => {
      fetchMock.mockResolvedValueOnce(
        json({ code: 'invalidClientIdOrSecret', message: '无效的clientId或者clientSecret' }, 400),
      );

      const error = await client.getAccessToken().catch((e) => e);
      expect(error).toBeInstanceOf(DingTalkApiError);
      expect(error).toMatchObject({ code: 'invalidClientIdOrSecret', kind: 'auth', status: 400 });
    });

    it('re-fetches the token and retries once when the API reports it expired', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse('stale'))
        .mockResolvedValueOnce(
          json({ code: 'InvalidAuthentication', message: '不合法的access_token' }, 401),
        )
        .mockResolvedValueOnce(tokenResponse('fresh'))
        .mockResolvedValueOnce(json({ processQueryKey: 'pqk_1' }));

      const result = await client.sendGroupMessage('cid_1', {
        msgKey: 'sampleText',
        msgParam: { content: 'hi' },
      });

      expect(result.processQueryKey).toBe('pqk_1');
      expect(fetchMock.mock.calls[1][1].headers['x-acs-dingtalk-access-token']).toBe('stale');
      expect(fetchMock.mock.calls[3][1].headers['x-acs-dingtalk-access-token']).toBe('fresh');
    });

    it('gives up after one retry when the fresh token is rejected too', async () => {
      const unauthorized = () => json({ code: 'InvalidAuthentication' }, 401);
      fetchMock
        .mockResolvedValueOnce(tokenResponse('a'))
        .mockResolvedValueOnce(unauthorized())
        .mockResolvedValueOnce(tokenResponse('b'))
        .mockResolvedValueOnce(unauthorized());

      await expect(
        client.sendGroupMessage('cid', { msgKey: 'sampleText', msgParam: { content: 'x' } }),
      ).rejects.toMatchObject({ kind: 'auth' });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('stream registration', () => {
    it('posts credentials and subscriptions to /v1.0/gateway/connections/open', async () => {
      fetchMock.mockResolvedValueOnce(json({ endpoint: 'wss://x/connect', ticket: 'tk' }));

      const res = await client.openStreamConnection([
        { topic: '/v1.0/im/bot/messages/get', type: 'CALLBACK' },
      ]);

      expect(res).toEqual({ endpoint: 'wss://x/connect', ticket: 'tk' });
      expect(url(0)).toBe(`${DINGTALK_API_BASE_URL}/v1.0/gateway/connections/open`);
      expect(body(0)).toMatchObject({
        clientId: 'ding_client',
        clientSecret: 'ding_secret',
        subscriptions: [{ topic: '/v1.0/im/bot/messages/get', type: 'CALLBACK' }],
      });
    });

    it('throws a typed error when registration is rejected', async () => {
      fetchMock.mockResolvedValueOnce(json({ code: 'Forbidden.AccessDenied', message: 'no' }, 403));

      await expect(client.openStreamConnection([])).rejects.toMatchObject({
        code: 'Forbidden.AccessDenied',
        kind: 'permission',
      });
    });
  });

  describe('robot send', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValueOnce(tokenResponse('tok'));
    });

    it('sends a single-chat message through oToMessages/batchSend', async () => {
      fetchMock.mockResolvedValueOnce(json({ processQueryKey: 'pqk' }));

      await client.sendSingleMessage(['staff_1'], {
        msgKey: 'sampleMarkdown',
        msgParam: { text: '**hi**', title: 'hi' },
      });

      expect(url(1)).toBe(`${DINGTALK_API_BASE_URL}/v1.0/robot/oToMessages/batchSend`);
      expect(body(1)).toEqual({
        msgKey: 'sampleMarkdown',
        msgParam: JSON.stringify({ text: '**hi**', title: 'hi' }),
        robotCode: 'ding_client',
        userIds: ['staff_1'],
      });
    });

    it('throws when batchSend rejects every recipient', async () => {
      fetchMock.mockResolvedValueOnce(
        json({ flowControlledStaffIdList: ['staff_1'], processQueryKey: 'pqk' }),
      );

      await expect(
        client.sendSingleMessage(['staff_1'], { msgKey: 'sampleText', msgParam: { content: 'x' } }),
      ).rejects.toMatchObject({ kind: 'rate_limit' });
    });

    it('sends a group message through groupMessages/send with robotCode', async () => {
      const custom = new DingTalkApiClient('ding_client', 'ding_secret', 'robot_x');
      fetchMock.mockResolvedValueOnce(json({ processQueryKey: 'pqk_g' }));

      const res = await custom.sendGroupMessage('cid_1', {
        msgKey: 'sampleText',
        msgParam: { content: 'hello' },
      });

      expect(res.processQueryKey).toBe('pqk_g');
      expect(url(1)).toBe(`${DINGTALK_API_BASE_URL}/v1.0/robot/groupMessages/send`);
      expect(body(1)).toEqual({
        msgKey: 'sampleText',
        msgParam: '{"content":"hello"}',
        openConversationId: 'cid_1',
        robotCode: 'robot_x',
      });
    });

    it('maps send.too.fast to a rate_limit error and keeps the DingTalk code', async () => {
      fetchMock.mockResolvedValueOnce(
        json({ code: 'send.too.fast', message: '发送太快', requestid: 'req_1' }, 400),
      );

      const error = await client
        .sendGroupMessage('cid', { msgKey: 'sampleText', msgParam: { content: 'x' } })
        .catch((e) => e);
      expect(error).toMatchObject({
        code: 'send.too.fast',
        kind: 'rate_limit',
        requestId: 'req_1',
        status: 400,
      });
    });

    it('exchanges a downloadCode for a temporary URL and downloads it', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ downloadUrl: 'https://cdn.dingtalk.com/f.png' }))
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));

      const buf = await client.downloadFile('dc_1');

      expect(url(1)).toBe(`${DINGTALK_API_BASE_URL}/v1.0/robot/messageFiles/download`);
      expect(body(1)).toEqual({ downloadCode: 'dc_1', robotCode: 'ding_client' });
      expect(url(2)).toBe('https://cdn.dingtalk.com/f.png');
      expect([...buf]).toEqual([1, 2, 3]);
    });
  });

  describe('sessionWebhook', () => {
    const WEBHOOK = 'https://oapi.dingtalk.com/robot/sendBySession?session=abc';

    it('posts text without an access token', async () => {
      fetchMock.mockResolvedValueOnce(json({ errcode: 0, errmsg: 'ok' }));

      await client.replyViaSessionWebhook(WEBHOOK, {
        msgKey: 'sampleText',
        msgParam: { content: 'hi' },
      });

      expect(url(0)).toBe(WEBHOOK);
      expect(fetchMock.mock.calls[0][1].headers['x-acs-dingtalk-access-token']).toBeUndefined();
      expect(body(0)).toEqual({ msgtype: 'text', text: { content: 'hi' } });
    });

    it('posts markdown with @ users', async () => {
      fetchMock.mockResolvedValueOnce(json({ errcode: 0 }));

      await client.replyViaSessionWebhook(
        WEBHOOK,
        { msgKey: 'sampleMarkdown', msgParam: { text: '# T', title: 'T' } },
        ['staff_1'],
      );

      expect(body(0)).toEqual({
        at: { atUserIds: ['staff_1'] },
        markdown: { text: '# T', title: 'T' },
        msgtype: 'markdown',
      });
    });

    it('throws a session_webhook error on a non-zero errcode (expired session)', async () => {
      fetchMock.mockResolvedValueOnce(json({ errcode: 300001, errmsg: 'session expired' }));

      await expect(
        client.replyViaSessionWebhook(WEBHOOK, {
          msgKey: 'sampleText',
          msgParam: { content: 'x' },
        }),
      ).rejects.toMatchObject({ code: '300001', kind: 'session_webhook' });
    });

    it('throws a session_webhook error on network failure', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(
        client.replyViaSessionWebhook(WEBHOOK, {
          msgKey: 'sampleText',
          msgParam: { content: 'x' },
        }),
      ).rejects.toMatchObject({ kind: 'session_webhook', status: 0 });
    });
  });
});

describe('classifyDingTalkError', () => {
  it.each([
    [401, undefined, 'auth'],
    [400, 'invalidParameter.token.invalid', 'auth'],
    [403, 'Forbidden.AccessDenied.AccessTokenInvalid', 'auth'],
    [400, 'send.too.fast', 'rate_limit'],
    [400, 'send.byToken.tooFast', 'rate_limit'],
    [429, 'Throttling.Api', 'rate_limit'],
    [400, 'too.many.people', 'rate_limit'],
    [403, 'Forbidden.AccessDenied.IpNotInWhiteList', 'permission'],
    [400, 'bot.forbidden.sendMessage', 'permission'],
    [400, 'invalidParameter.robotCode.notExsit', 'invalid_request'],
    [500, 'system.error', 'server'],
    [503, undefined, 'server'],
  ] as const)('status %d code %s → %s', (status, code, kind) => {
    expect(classifyDingTalkError(status, code)).toBe(kind);
  });
});

describe('truncateUtf8', () => {
  it('keeps short text unchanged', () => {
    expect(truncateUtf8('hello', 100)).toBe('hello');
  });

  it('cuts multi-byte text on a character boundary within the byte budget', () => {
    const text = '钉'.repeat(10); // 30 bytes
    const out = truncateUtf8(text, 12);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(12);
    expect(out).toBe('钉钉钉...');
  });
});
