import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adapter: {
    handleWebhook: vi.fn(),
    startGatewayListener: vi.fn(),
  },
  botReply: {
    forgetDingTalkSessionWebhook: vi.fn(),
    getDingTalkSessionWebhook: vi.fn(),
    rememberDingTalkSessionWebhook: vi.fn(),
  },
  chatInstances: [] as any[],
  updateBotRuntimeStatus: vi.fn(),
}));

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createDingTalkAdapter: vi.fn(() => mocks.adapter),
  };
});

vi.mock('chat', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeChat {
    adapters: Map<string, any>;
    initialize = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
    constructor(config: any) {
      this.adapters = new Map(Object.entries(config.adapters));
      mocks.chatInstances.push(this);
    }
  }
  return { ...actual, Chat: FakeChat };
});

vi.mock('@/server/services/redis', () => ({ redisService: { botReply: mocks.botReply } }));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => (e ? String(e?.message ?? e) : undefined),
  updateBotRuntimeStatus: mocks.updateBotRuntimeStatus,
}));

const { DingTalkApiError } = await import('@lobechat/chat-adapter-dingtalk');
const { classifyDingTalkCredentialError, DingTalkClientFactory, dingtalkExtractFiles } =
  await import('./client');

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const fetchMock = vi.fn();

const createClient = (settings: Record<string, unknown> = {}) =>
  new DingTalkClientFactory().createClient(
    {
      applicationId: 'dingapp',
      credentials: { clientSecret: 'secret' },
      platform: 'dingtalk',
      settings,
    },
    { appUrl: 'https://app.example.com' },
  );

const statuses = () => mocks.updateBotRuntimeStatus.mock.calls.map(([arg]) => arg.status);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chatInstances.length = 0;
  mocks.adapter.startGatewayListener.mockResolvedValue(undefined);
  mocks.botReply.getDingTalkSessionWebhook.mockResolvedValue(undefined);
  mocks.updateBotRuntimeStatus.mockResolvedValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DingTalkClientFactory.validateCredentials', () => {
  const factory = new DingTalkClientFactory();

  it('reports every missing field before calling DingTalk', async () => {
    const result = await factory.validateCredentials({ clientSecret: '' }, {}, '');

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { code: 'missing_credentials', field: 'applicationId', message: 'Client ID is required' },
      { code: 'missing_credentials', field: 'clientSecret', message: 'Client Secret is required' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts credentials once the accessToken endpoint issues a token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'tok', expireIn: 7200 }));

    const result = await factory.validateCredentials({ clientSecret: 'secret' }, {}, 'dingapp');

    expect(result).toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledWith(
      TOKEN_URL,
      expect.objectContaining({
        body: JSON.stringify({ appKey: 'dingapp', appSecret: 'secret' }),
        method: 'POST',
      }),
    );
  });

  it('labels a rejected Client ID / Secret as invalid credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      // Body captured from the real endpoint with a wrong Client ID / Secret.
      jsonResponse(400, {
        code: 'invalidClientIdOrSecret',
        message: '无效的clientId或者clientSecret',
        requestid: '01A1ACCF-8F3D-76EF-97BC-6BAC71012EBE',
      }),
    );

    const result = await factory.validateCredentials({ clientSecret: 'bad' }, {}, 'dingapp');

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toMatchObject({ code: 'invalid_credentials', field: 'credentials' });
    expect(result.errors![0].message).toMatch(/^Invalid DingTalk Client ID or Client Secret: /);
    expect(result.errors![0].message).toContain('invalidClientIdOrSecret');
  });

  it('labels a forbidden app as permission denied', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { code: 'Forbidden.AccessDenied.IpNotInWhiteList', message: 'ip denied' }),
    );

    const result = await factory.validateCredentials({ clientSecret: 'secret' }, {}, 'dingapp');

    expect(result.errors![0]).toMatchObject({ code: 'permission_denied', field: 'credentials' });
    expect(result.errors![0].message).toMatch(/^DingTalk denied access for this app: /);
  });

  it('labels an unreachable API as a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await factory.validateCredentials({ clientSecret: 'secret' }, {}, 'dingapp');

    expect(result.errors![0]).toEqual({
      code: 'upstream_unavailable',
      field: 'credentials',
      message: 'Could not reach the DingTalk API: fetch failed',
    });
  });

  it('labels a DingTalk outage as upstream unavailable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 'system.error', message: 'busy' }));

    const result = await factory.validateCredentials({ clientSecret: 'secret' }, {}, 'dingapp');

    expect(result.errors![0].code).toBe('upstream_unavailable');
  });

  it('labels throttling as rate limited', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 'Throttling', message: 'slow' }));

    const result = await factory.validateCredentials({ clientSecret: 'secret' }, {}, 'dingapp');

    expect(result.errors![0].code).toBe('rate_limited');
  });
});

describe('classifyDingTalkCredentialError', () => {
  const apiError = (status: number, code?: string, kind: any = 'auth') =>
    new DingTalkApiError({ code, kind, message: `DingTalk ${status}`, status });

  it.each([
    [apiError(400, 'invalidClientId'), 'invalid_credentials'],
    [apiError(401, 'InvalidAuthentication'), 'invalid_credentials'],
    [apiError(403, 'Forbidden.AccessDenied'), 'permission_denied'],
    [apiError(400, 'Forbidden.AccessDenied.AccessTokenPermissionDenied'), 'permission_denied'],
    [apiError(429), 'rate_limited'],
    [apiError(400, 'send.too.fast'), 'rate_limited'],
    [apiError(500, undefined, 'server'), 'upstream_unavailable'],
    [new Error('getaddrinfo ENOTFOUND api.dingtalk.com'), 'upstream_unavailable'],
    [
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      'upstream_unavailable',
    ],
    [new Error('something else'), undefined],
  ])('maps %s to %s', (error, code) => {
    expect(classifyDingTalkCredentialError(error)).toBe(code);
  });
});

describe('DingTalkClientFactory.createClient', () => {
  it('defaults to Stream mode and starts a gateway listener on the webhook route', async () => {
    const client = createClient({ connectionMode: 'websocket' });

    await client.start({ durationMs: 60_000 });

    expect(mocks.adapter.startGatewayListener).toHaveBeenCalledWith(
      { waitUntil: expect.any(Function) },
      60_000,
      expect.any(AbortSignal),
      'https://app.example.com/api/agent/webhooks/dingtalk/dingapp',
    );
    expect(statuses()).toEqual(['starting', 'connected']);
  });

  it('treats a row without connectionMode as Stream mode', async () => {
    await createClient().start({ durationMs: 1000 });
    expect(mocks.adapter.startGatewayListener).toHaveBeenCalledTimes(1);
  });

  it('only verifies credentials in HTTP callback mode', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'tok', expireIn: 7200 }));
    const client = createClient({ connectionMode: 'webhook' });

    await client.start();

    expect(mocks.adapter.startGatewayListener).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(TOKEN_URL, expect.anything());
    expect(statuses()).toEqual(['starting', 'connected']);

    await client.stop();
    expect(statuses()).toEqual(['starting', 'connected', 'disconnected']);
  });

  it('marks the bot failed when HTTP callback credentials are rejected', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { code: 'invalidClientId', message: 'x' }));
    const client = createClient({ connectionMode: 'webhook' });

    await expect(client.start()).rejects.toThrow();
    expect(statuses()).toEqual(['starting', 'failed']);
  });
});

describe('DingTalk gateway lifecycle', () => {
  it('marks the bot failed and rethrows when the Stream connection cannot open', async () => {
    mocks.adapter.startGatewayListener.mockRejectedValueOnce(new Error('stream open 401'));
    const client = createClient({ connectionMode: 'websocket' });

    await expect(client.start({ durationMs: 1000 })).rejects.toThrow('stream open 401');
    expect(mocks.updateBotRuntimeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorMessage: 'stream open 401', status: 'failed' }),
      expect.anything(),
    );
  });

  it('aborts the socket and shuts the bot down on stop', async () => {
    const client = createClient({ connectionMode: 'websocket' });
    await client.start({ durationMs: 1000 });
    const signal = mocks.adapter.startGatewayListener.mock.calls[0][2] as AbortSignal;

    await client.stop();

    expect(signal.aborted).toBe(true);
    expect(mocks.chatInstances[0].shutdown).toHaveBeenCalled();
    expect(statuses().at(-1)).toBe('disconnected');
  });

  it('replaces the previous connection when started again (credential change / refresh)', async () => {
    const client = createClient({ connectionMode: 'websocket' });
    await client.start({ durationMs: 1000 });
    const firstSignal = mocks.adapter.startGatewayListener.mock.calls[0][2] as AbortSignal;

    await client.start({ durationMs: 1000 });

    expect(firstSignal.aborted).toBe(true);
    expect(mocks.chatInstances[0].shutdown).toHaveBeenCalled();
    expect(mocks.chatInstances).toHaveLength(2);
    const secondSignal = mocks.adapter.startGatewayListener.mock.calls[1][2] as AbortSignal;
    expect(secondSignal.aborted).toBe(false);
  });

  it('refreshes itself after the duration when started without gateway options', async () => {
    vi.useFakeTimers();
    try {
      const client = createClient({ connectionMode: 'websocket' });
      await client.start();
      expect(mocks.adapter.startGatewayListener).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);

      expect(mocks.adapter.startGatewayListener).toHaveBeenCalledTimes(2);
      await client.stop();
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
      expect(mocks.adapter.startGatewayListener).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DingTalk messenger', () => {
  const tokenThen = (...responses: Response[]) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'tok', expireIn: 7200 }));
    for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  };

  const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

  it('replies to a group through groupMessages/send', async () => {
    tokenThen(jsonResponse(200, { processQueryKey: 'pqk' }));
    const messenger = createClient().getMessenger('dingtalk:group:cidABC==');

    await messenger.createMessage('done');

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.dingtalk.com/v1.0/robot/groupMessages/send',
    );
    expect(bodyOf(1)).toEqual({
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: 'done' }),
      openConversationId: 'cidABC==',
      robotCode: 'dingapp',
    });
  });

  it('replies to a single chat through oToMessages/batchSend with markdown', async () => {
    tokenThen(jsonResponse(200, { processQueryKey: 'pqk' }));
    const messenger = createClient().getMessenger('dingtalk:single:staff-1');

    await messenger.createMessage('**结论**：可以');

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
    );
    const body = bodyOf(1);
    expect(body.userIds).toEqual(['staff-1']);
    expect(body.msgKey).toBe('sampleMarkdown');
    expect(JSON.parse(body.msgParam)).toMatchObject({ text: '**结论**：可以' });
  });

  it('prefers a stored sessionWebhook and needs no access token for it', async () => {
    mocks.botReply.getDingTalkSessionWebhook.mockResolvedValueOnce({
      expiresAt: Date.now() + 3_600_000,
      url: 'https://oapi.dingtalk.com/robot/sendBySession?session=s1',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { errcode: 0, errmsg: 'ok' }));
    const messenger = createClient().getMessenger('dingtalk:single:$:LWCP_v1:$ext');

    await messenger.createMessage('hi');

    expect(mocks.botReply.getDingTalkSessionWebhook).toHaveBeenCalledWith(
      'dingapp',
      'dingtalk:single:$:LWCP_v1:$ext',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://oapi.dingtalk.com/robot/sendBySession?session=s1',
    );
    expect(bodyOf(0)).toMatchObject({ msgtype: 'text', text: { content: 'hi' } });
  });

  it('drops a rejected sessionWebhook and falls back to the OpenAPI', async () => {
    mocks.botReply.getDingTalkSessionWebhook.mockResolvedValueOnce({
      expiresAt: Date.now() + 3_600_000,
      url: 'https://oapi.dingtalk.com/robot/sendBySession?session=old',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { errcode: 300001, errmsg: 'expired' }));
    tokenThen(jsonResponse(200, { processQueryKey: 'pqk' }));
    const messenger = createClient().getMessenger('dingtalk:group:cid1');

    await messenger.createMessage('fallback');

    expect(mocks.botReply.forgetDingTalkSessionWebhook).toHaveBeenCalledWith(
      'dingapp',
      'dingtalk:group:cid1',
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.dingtalk.com/v1.0/robot/groupMessages/send',
    );
  });

  it('sends an edit as a new message and treats reactions as no-ops', async () => {
    tokenThen(jsonResponse(200, { processQueryKey: 'pqk' }));
    const messenger = createClient().getMessenger('dingtalk:group:cid1');

    await messenger.editMessage('mid', 'updated');
    await messenger.removeReaction('mid', '👀');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(bodyOf(1).msgParam)).toEqual({ content: 'updated' });
  });

  it('uses a configured RobotCode for sends', async () => {
    tokenThen(jsonResponse(200, { processQueryKey: 'pqk' }));
    const client = new DingTalkClientFactory().createClient(
      {
        applicationId: 'dingapp',
        credentials: { clientSecret: 'secret', robotCode: 'robot-x' },
        platform: 'dingtalk',
        settings: {},
      },
      {},
    );

    await client.getMessenger('dingtalk:group:cid1').createMessage('x');

    expect(bodyOf(1).robotCode).toBe('robot-x');
  });

  it('extracts the conversation id, keeping colons of encrypted sender ids', () => {
    const client = createClient();
    expect(client.extractChatId('dingtalk:group:cid1==')).toBe('cid1==');
    expect(client.extractChatId('dingtalk:single:$:LWCP_v1:$abc')).toBe('$:LWCP_v1:$abc');
  });

  it('keeps markdown and appends usage stats only when enabled', () => {
    expect(createClient().formatMarkdown!('**a**')).toBe('**a**');
    const stats = { totalCost: 0, totalTokens: 1200 } as any;
    expect(createClient().formatReply!('body', stats)).toBe('body');
    expect(createClient({ showUsageStats: true }).formatReply!('body', stats)).toMatch(/^body\n\n/);
  });
});

describe('dingtalkExtractFiles', () => {
  const api = { getFileDownloadUrl: vi.fn() } as any;

  beforeEach(() => {
    api.getFileDownloadUrl.mockReset();
    api.getFileDownloadUrl.mockImplementation(async (code: string) => `https://dl.example/${code}`);
  });

  const message = (raw: Record<string, unknown>) => ({ raw: { msgId: 'm1', ...raw } }) as any;

  it('returns undefined for plain text', async () => {
    expect(
      await dingtalkExtractFiles(api, message({ msgtype: 'text', text: { content: 'hi' } })),
    ).toBeUndefined();
    expect(api.getFileDownloadUrl).not.toHaveBeenCalled();
  });

  it('resolves every picture of a richText message', async () => {
    const result = await dingtalkExtractFiles(
      api,
      message({
        content: {
          richText: [{ text: 'look' }, { downloadCode: 'a' }, { pictureDownloadCode: 'b' }],
        },
        msgtype: 'richText',
      }),
    );
    expect(result).toEqual([
      { name: undefined, url: 'https://dl.example/a' },
      { name: undefined, url: 'https://dl.example/b' },
    ]);
  });

  it('keeps the file name so the MIME type can be inferred', async () => {
    const result = await dingtalkExtractFiles(
      api,
      message({ content: { downloadCode: 'f', fileName: 'report.pdf' }, msgtype: 'file' }),
    );
    expect(result).toEqual([{ name: 'report.pdf', url: 'https://dl.example/f' }]);
  });

  it.each(['picture', 'audio', 'video'])('resolves a %s download code', async (msgtype) => {
    const result = await dingtalkExtractFiles(
      api,
      message({ content: { downloadCode: 'c' }, msgtype }),
    );
    expect(result).toEqual([{ name: undefined, url: 'https://dl.example/c' }]);
  });

  it('skips codes DingTalk refuses to resolve', async () => {
    api.getFileDownloadUrl.mockRejectedValueOnce(new Error('expired'));
    expect(
      await dingtalkExtractFiles(
        api,
        message({ content: { downloadCode: 'x' }, msgtype: 'picture' }),
      ),
    ).toBeUndefined();
  });
});
