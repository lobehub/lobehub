import { createCipheriv, randomBytes } from 'node:crypto';

import { getWeComConnection } from '@lobechat/chat-adapter-wecom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Stand-in for the WeCom long-connection server, installed as the `ws` WebSocket. */
const { FakeSocket } = vi.hoisted(() => {
  class FakeSocket {
    static instances: FakeSocket[] = [];
    static subscribeErrcode = 0;
    static holdSubscribe = false;
    static held: Array<() => void> = [];
    static releaseSubscribe() {
      for (const release of FakeSocket.held.splice(0)) release();
    }

    readyState = 0;
    readonly sent: any[] = [];
    private readonly listeners = new Map<string, Array<(event: any) => void>>();

    constructor(readonly url: string) {
      FakeSocket.instances.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit('open', {});
      });
    }

    addEventListener(type: string, listener: (event: any) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    send(data: string) {
      const frame = JSON.parse(data);
      this.sent.push(frame);
      const errcode = frame.cmd === 'aibot_subscribe' ? FakeSocket.subscribeErrcode : 0;
      const ack = () =>
        this.serverSend({
          errcode,
          errmsg: errcode ? 'invalid secret' : 'ok',
          headers: frame.headers,
        });
      if (frame.cmd === 'aibot_subscribe' && FakeSocket.holdSubscribe) {
        FakeSocket.held.push(ack);
        return;
      }
      queueMicrotask(ack);
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close', { code: 1000 });
    }

    serverSend(frame: unknown) {
      this.emit('message', { data: JSON.stringify(frame) });
    }

    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }
  return { FakeSocket };
});

vi.mock('ws', () => ({ default: FakeSocket }));

const appEnv = vi.hoisted(
  () => ({ APP_URL: undefined, INTERNAL_APP_URL: undefined }) as Record<string, string | undefined>,
);
vi.mock('@/envs/app', () => ({ appEnv }));

const { updateBotRuntimeStatus } = vi.hoisted(() => ({
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => String(e?.message ?? e),
  updateBotRuntimeStatus,
}));

const { decodeWeComThreadId, WECOM_DISPLACED_MESSAGE, WeComClientFactory, wecomExtractFiles } =
  await import('./client');

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const config = {
  applicationId: 'bot-1',
  credentials: { secret: 'sec' },
  platform: 'wecom',
  settings: {},
};

const factory = new WeComClientFactory();
let clients: Array<{ stop: () => Promise<void> }> = [];

beforeEach(() => {
  FakeSocket.instances = [];
  FakeSocket.subscribeErrcode = 0;
  FakeSocket.held = [];
  updateBotRuntimeStatus.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"ok":true}')),
  );
});

afterEach(async () => {
  for (const client of clients) await client.stop();
  clients = [];
  vi.unstubAllGlobals();
});

const startClient = async () => {
  const client = factory.createClient(config, { appUrl: 'https://app.example.com' });
  clients.push(client);
  await client.start();
  return client;
};

const statuses = () => updateBotRuntimeStatus.mock.calls.map(([params]) => params.status);

describe('WeComClient lifecycle', () => {
  it('subscribes, registers the live connection and reports connected', async () => {
    await startClient();

    const socket = FakeSocket.instances[0];
    expect(socket.url).toBe('wss://openws.work.weixin.qq.com');
    expect(socket.sent[0]).toMatchObject({
      body: { bot_id: 'bot-1', secret: 'sec' },
      cmd: 'aibot_subscribe',
    });
    expect(getWeComConnection('bot-1')?.isConnected).toBe(true);
    expect(statuses()).toEqual(['starting', 'connected']);
  });

  it('forwards inbound messages to the WeCom webhook route', async () => {
    await startClient();
    FakeSocket.instances[0].serverSend({
      body: {
        aibotid: 'bot-1',
        chattype: 'single',
        from: { userid: 'u1' },
        msgid: 'm1',
        msgtype: 'text',
        text: { content: 'hi' },
      },
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'req-1' },
    });
    await flush();

    expect(fetch).toHaveBeenCalledWith(
      'https://app.example.com/api/agent/webhooks/wecom/bot-1',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('forwards through INTERNAL_APP_URL when set, as other server-to-server calls do', async () => {
    appEnv.INTERNAL_APP_URL = 'http://lobe:3210/';
    try {
      await startClient();
      FakeSocket.instances[0].serverSend({
        body: {
          aibotid: 'bot-1',
          chattype: 'single',
          from: { userid: 'u1' },
          msgid: 'm1',
          msgtype: 'text',
          text: { content: 'hi' },
        },
        cmd: 'aibot_msg_callback',
        headers: { req_id: 'req-1' },
      });
      await flush();
      expect(fetch).toHaveBeenCalledWith(
        'http://lobe:3210/api/agent/webhooks/wecom/bot-1',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      appEnv.INTERNAL_APP_URL = undefined;
    }
  });

  it('stays stopped once displaced: the periodic refresh does not take the bot back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const client = factory.createClient(config, { appUrl: 'https://app.example.com' });
      clients.push(client);
      const started = client.start();
      await vi.advanceTimersByTimeAsync(0);
      await started;

      FakeSocket.instances[0].serverSend({
        body: { event: { eventtype: 'disconnected_event' } },
        cmd: 'aibot_event_callback',
        headers: { req_id: 'evt' },
      });
      await vi.advanceTimersByTimeAsync(0);
      const sockets = FakeSocket.instances.length;

      await vi.advanceTimersByTimeAsync(9 * 60 * 60 * 1000);
      expect(FakeSocket.instances).toHaveLength(sockets);
      expect(getWeComConnection('bot-1')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors a stop that arrives while the subscribe is pending', async () => {
    FakeSocket.holdSubscribe = true;
    try {
      const client = factory.createClient(config, {});
      clients.push(client);
      const started = client.start();
      await flush();
      await client.stop();
      FakeSocket.releaseSubscribe();
      await started;

      expect(getWeComConnection('bot-1')).toBeUndefined();
      expect(statuses()).not.toContain('connected');
      expect(statuses().at(-1)).toBe('disconnected');
    } finally {
      FakeSocket.holdSubscribe = false;
    }
  });

  it('retries a failed periodic refresh instead of staying offline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const client = factory.createClient(config, { appUrl: 'https://app.example.com' });
      clients.push(client);
      const started = client.start();
      await vi.advanceTimersByTimeAsync(0);
      await started;

      // The refresh's re-subscribe is refused once, then accepted.
      FakeSocket.subscribeErrcode = 50_001;
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000 + 10);
      expect(getWeComConnection('bot-1')).toBeUndefined();

      FakeSocket.subscribeErrcode = 0;
      await vi.advanceTimersByTimeAsync(61 * 1000);
      expect(getWeComConnection('bot-1')?.isConnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports failed and throws when WeCom refuses the credentials', async () => {
    FakeSocket.subscribeErrcode = 40_058;
    const client = factory.createClient(config, {});
    clients.push(client);

    await expect(client.start()).rejects.toThrow(/invalid secret/);
    expect(statuses()).toEqual(['starting', 'failed']);
    expect(getWeComConnection('bot-1')).toBeUndefined();
  });

  it('reports the takeover when a newer connection displaces this one', async () => {
    await startClient();
    FakeSocket.instances[0].serverSend({
      body: { event: { eventtype: 'disconnected_event' } },
      cmd: 'aibot_event_callback',
      headers: { req_id: 'evt' },
    });
    await flush();

    expect(updateBotRuntimeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorMessage: WECOM_DISPLACED_MESSAGE, status: 'failed' }),
      expect.anything(),
    );
    expect(getWeComConnection('bot-1')).toBeUndefined();
  });

  it('unregisters on stop and reports disconnected', async () => {
    const client = await startClient();
    await client.stop();
    expect(getWeComConnection('bot-1')).toBeUndefined();
    expect(statuses().at(-1)).toBe('disconnected');
  });
});

describe('WeComClient messenger', () => {
  it('answers on the live connection: typing opens the stream, the reply finishes it', async () => {
    const client = await startClient();
    const socket = FakeSocket.instances[0];
    socket.serverSend({
      body: {
        aibotid: 'bot-1',
        chatid: 'g1',
        chattype: 'group',
        from: { userid: 'u1' },
        msgid: 'm1',
        msgtype: 'text',
        text: { content: '@bot hi' },
      },
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'req-g' },
    });
    await flush();

    const messenger = client.getMessenger('wecom:group:g1');
    await messenger.triggerTyping!();
    await messenger.createMessage({ content: 'answer' });

    const replies = socket.sent.filter((frame) => frame.cmd === 'aibot_respond_msg');
    expect(replies.map((frame) => [frame.headers.req_id, frame.body.stream.finish])).toEqual([
      ['req-g', false],
      ['req-g', true],
    ]);
    expect(replies[1].body.stream.content).toBe('answer');
  });

  it('fails clearly when this process does not hold the connection', async () => {
    const client = factory.createClient(config, {});
    await expect(client.getMessenger('wecom:single:u1').createMessage('x')).rejects.toThrow(
      /no live long connection/,
    );
  });
});

describe('WeComClientFactory.validateCredentials', () => {
  it('requires BotID and Secret', async () => {
    const result = await factory.validateCredentials({}, undefined, undefined);
    expect(result.valid).toBe(false);
    expect(result.errors?.map((e) => e.field)).toEqual(['applicationId', 'secret']);
  });

  it('accepts a bot this process already runs with the same Secret, without a probe', async () => {
    await startClient();
    const before = FakeSocket.instances.length;

    await expect(factory.validateCredentials({ secret: 'sec' }, {}, 'bot-1')).resolves.toEqual({
      valid: true,
    });
    // A probe would subscribe again and kick the live connection off.
    expect(FakeSocket.instances).toHaveLength(before);
  });

  it('probes with a short-lived subscribe otherwise', async () => {
    await expect(factory.validateCredentials({ secret: 'sec' }, {}, 'bot-2')).resolves.toEqual({
      valid: true,
    });
    expect(FakeSocket.instances[0].readyState).toBe(3);

    FakeSocket.subscribeErrcode = 40_058;
    const refused = await factory.validateCredentials({ secret: 'bad' }, {}, 'bot-3');
    expect(refused).toMatchObject({ errors: [{ code: 'invalid_credentials' }], valid: false });
  });
});

describe('wecomExtractFiles', () => {
  const encrypt = (plain: Buffer, key: Buffer) => {
    const pad = 32 - (plain.length % 32);
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    return Buffer.concat([
      cipher.update(Buffer.concat([plain, Buffer.alloc(pad, pad)])),
      cipher.final(),
    ]);
  };

  it('downloads and decrypts media while the URL is still valid', async () => {
    const key = randomBytes(32);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const fetchImpl = vi.fn(async () => new Response(encrypt(jpeg, key)));

    const result = await wecomExtractFiles(
      {
        raw: {
          body: { image: { aeskey: key.toString('base64'), url: 'https://img' }, msgtype: 'image' },
          reqId: 'r',
        },
      } as any,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result?.files).toHaveLength(1);
    expect(result!.files![0]).toMatchObject({ mimeType: 'image/jpeg', size: jpeg.length });
    expect(result!.files![0].buffer!.equals(jpeg)).toBe(true);
  });

  it('turns a failed download into a warning', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    const result = await wecomExtractFiles(
      { raw: { body: { file: { url: 'https://f' }, msgtype: 'file' }, reqId: 'r' } } as any,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ files: undefined, warnings: [expect.stringContaining('file')] });
  });

  it('returns undefined for text-only messages', async () => {
    await expect(
      wecomExtractFiles({ raw: { body: { msgtype: 'text' }, reqId: 'r' } } as any),
    ).resolves.toBeUndefined();
  });
});

describe('decodeWeComThreadId', () => {
  it('splits type and id, keeping colons in the id', () => {
    expect(decodeWeComThreadId('wecom:group:g:1')).toEqual({ id: 'g:1', type: 'group' });
    expect(decodeWeComThreadId('wecom:single:u1')).toEqual({ id: 'u1', type: 'single' });
  });
});
