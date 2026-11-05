import { afterEach, describe, expect, it, vi } from 'vitest';

import { truncateUtf8, WeComLongConnection } from './connection';
import { verifyForwardedFrame, WECOM_SIGNATURE_HEADER, WECOM_TIMESTAMP_HEADER } from './crypto';
import { FakeWeComServerSocket, flush } from './testUtils';
import type { WeComFrame, WeComMessageBody } from './types';
import { WECOM_CMD } from './types';

const SECRET = 'bot-secret';

const setup = (overrides: Partial<ConstructorParameters<typeof WeComLongConnection>[0]> = {}) => {
  const sockets: FakeWeComServerSocket[] = [];
  const fetchImpl = vi.fn(async () => new Response('{"ok":true}'));
  const connection = new WeComLongConnection({
    botId: 'bot-1',
    createSocket: (url) => {
      const socket = new FakeWeComServerSocket(url);
      sockets.push(socket);
      return socket;
    },
    fetchImpl: fetchImpl as unknown as typeof fetch,
    secret: SECRET,
    webhookUrl: 'https://app.example.com/api/agent/webhooks/wecom/bot-1',
    ...overrides,
  });
  return { connection, fetchImpl, socket: () => sockets.at(-1)!, sockets };
};

const inbound = (
  reqId: string,
  body: Partial<WeComMessageBody> = {},
): WeComFrame<WeComMessageBody> => ({
  body: {
    aibotid: 'bot-1',
    chattype: 'single',
    from: { userid: 'zhangsan' },
    msgid: `msg-${reqId}`,
    msgtype: 'text',
    text: { content: 'hello' },
    ...body,
  },
  cmd: WECOM_CMD.MSG_CALLBACK,
  headers: { req_id: reqId },
});

let active: WeComLongConnection | undefined;
afterEach(() => {
  active?.stop();
  active = undefined;
  vi.useRealTimers();
});

describe('WeComLongConnection — subscribe', () => {
  it('subscribes with BotID + Secret and resolves on errcode 0', async () => {
    const { connection, socket } = setup();
    active = connection;
    await connection.start();

    const [subscribe] = socket().sentWith(WECOM_CMD.SUBSCRIBE);
    expect(subscribe.body).toEqual({ bot_id: 'bot-1', secret: SECRET });
    expect(subscribe.headers.req_id).toMatch(/^aibot_subscribe_/);
    expect(connection.isConnected).toBe(true);
  });

  it('rejects start() when WeCom refuses the credentials, and does not retry', async () => {
    const { connection, socket, sockets } = setup({
      createSocket: (url) => {
        const s = new FakeWeComServerSocket(url);
        s.ackFor = (frame) =>
          frame.cmd === WECOM_CMD.SUBSCRIBE ? { errcode: 40_058, errmsg: 'invalid secret' } : {};
        sockets.push(s);
        return s;
      },
    });
    active = connection;

    await expect(connection.start()).rejects.toThrow(/invalid secret.*40058/);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(socket().readyState).toBe(3);
  });

  it('times out when no subscribe receipt arrives', async () => {
    const { connection } = setup({
      connectTimeoutMs: 20,
      createSocket: (url) => {
        const s = new FakeWeComServerSocket(url);
        s.ackFor = () => undefined;
        return s;
      },
    });
    active = connection;
    await expect(connection.start()).rejects.toThrow(/timed out/);
  });
});

describe('WeComLongConnection — inbound forwarding', () => {
  it('forwards message frames to the webhook, signed with the Secret', async () => {
    const { connection, fetchImpl, socket } = setup();
    active = connection;
    await connection.start();

    socket().serverSend(inbound('req-1'));
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://app.example.com/api/agent/webhooks/wecom/bot-1');
    const headers = init.headers as Record<string, string>;
    expect(
      verifyForwardedFrame(
        SECRET,
        headers[WECOM_TIMESTAMP_HEADER],
        headers[WECOM_SIGNATURE_HEADER],
        init.body as string,
      ),
    ).toBe(true);
    expect(JSON.parse(init.body as string).headers.req_id).toBe('req-1');
  });

  it('does not forward events', async () => {
    const { connection, fetchImpl, socket } = setup();
    active = connection;
    await connection.start();

    socket().serverSend({
      body: { event: { eventtype: 'enter_chat' } },
      cmd: WECOM_CMD.EVENT_CALLBACK,
      headers: { req_id: 'evt-1' },
    });
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('WeComLongConnection — replies', () => {
  it('opens a stream on the latest message and finishes it with the reply', async () => {
    const { connection, socket } = setup();
    active = connection;
    await connection.start();
    socket().serverSend(inbound('req-1'));
    await flush();

    const thread = { id: 'zhangsan', type: 'single' as const };
    await expect(connection.openStream(thread)).resolves.toBe(true);
    // A second typing renewal keeps the same bubble.
    await expect(connection.openStream(thread)).resolves.toBe(true);
    const result = await connection.deliver(thread, '**done**');

    const replies = socket().sentWith(WECOM_CMD.RESPOND);
    expect(replies).toHaveLength(2);
    expect(replies.map((f) => f.headers.req_id)).toEqual(['req-1', 'req-1']);
    expect(replies[0].body.stream).toMatchObject({ content: '', finish: false });
    expect(replies[1].body.stream).toEqual({
      content: '**done**',
      finish: true,
      id: replies[0].body.stream.id,
    });
    expect(result).toEqual({ id: replies[0].body.stream.id, via: 'stream' });
  });

  it('answers an unanswered message passively when no stream is open', async () => {
    const { connection, socket } = setup();
    active = connection;
    await connection.start();
    socket().serverSend(inbound('req-g', { chatid: 'group-9', chattype: 'group' }));
    await flush();

    const result = await connection.deliver({ id: 'group-9', type: 'group' }, 'hi group');
    const [reply] = socket().sentWith(WECOM_CMD.RESPOND);
    expect(reply.headers.req_id).toBe('req-g');
    expect(reply.body.stream).toMatchObject({ content: 'hi group', finish: true });
    expect(result.via).toBe('reply');
  });

  it('pushes proactively once the message was answered', async () => {
    const { connection, socket } = setup();
    active = connection;
    await connection.start();
    socket().serverSend(inbound('req-1'));
    await flush();

    const thread = { id: 'zhangsan', type: 'single' as const };
    await connection.deliver(thread, 'first');
    const result = await connection.deliver(thread, 'second');

    const [push] = socket().sentWith(WECOM_CMD.SEND_MSG);
    expect(push.body).toEqual({
      chatid: 'zhangsan',
      markdown: { content: 'second' },
      msgtype: 'markdown',
    });
    expect(result.via).toBe('push');
  });

  it('falls back to a push when the passive reply is refused', async () => {
    const { connection, socket } = setup();
    active = connection;
    await connection.start();
    socket().ackFor = (frame) =>
      frame.cmd === WECOM_CMD.RESPOND ? { errcode: 846_605, errmsg: 'expired' } : { errcode: 0 };
    socket().serverSend(inbound('req-1'));
    await flush();

    const result = await connection.deliver({ id: 'zhangsan', type: 'single' }, 'reply');
    expect(result.via).toBe('push');
    expect(socket().sentWith(WECOM_CMD.SEND_MSG)).toHaveLength(1);
  });

  it('treats a message older than the reply window as unanswerable', async () => {
    let now = 1_000_000;
    const { connection, socket } = setup({ now: () => now, replyWindowMs: 1000 });
    active = connection;
    await connection.start();
    socket().serverSend(inbound('req-1'));
    await flush();

    now += 5000;
    await expect(connection.openStream({ id: 'zhangsan', type: 'single' })).resolves.toBe(false);
  });

  it('keeps frames on one req_id in order, each after the previous receipt', async () => {
    const { connection, socket } = setup();
    active = connection;
    await connection.start();
    const held: Array<() => void> = [];
    socket().ackFor = (frame) => {
      if (frame.cmd !== WECOM_CMD.RESPOND) return { errcode: 0 };
      held.push(() => socket().serverSend({ errcode: 0, headers: frame.headers }));
      return undefined;
    };

    const body = (content: string) => ({
      msgtype: 'stream' as const,
      stream: { content, finish: false, id: 's' },
    });
    const first = connection.respond('req-1', body('a'));
    const second = connection.respond('req-1', body('b'));
    await flush();
    expect(socket().sentWith(WECOM_CMD.RESPOND)).toHaveLength(1);

    held.shift()!();
    await first;
    await flush();
    expect(socket().sentWith(WECOM_CMD.RESPOND)).toHaveLength(2);
    held.shift()!();
    await second;
  });

  it('closes a stream before the 10-minute limit; the reply then goes as a push', async () => {
    const { connection, socket } = setup({ streamMaxOpenMs: 30 });
    active = connection;
    await connection.start();
    socket().serverSend(inbound('req-1'));
    await flush();

    const thread = { id: 'zhangsan', type: 'single' as const };
    await connection.openStream(thread);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const replies = socket().sentWith(WECOM_CMD.RESPOND);
    expect(replies.at(-1)!.body.stream).toMatchObject({ content: '…', finish: true });
    await expect(connection.deliver(thread, 'late')).resolves.toMatchObject({ via: 'push' });
  });

  it('rejects outbound frames when disconnected', async () => {
    const { connection } = setup();
    active = connection;
    await expect(connection.push({ id: 'x', type: 'single' }, 'hi')).rejects.toThrow(
      /not connected/,
    );
  });
});

describe('WeComLongConnection — lifecycle', () => {
  it('stops without reconnecting when a newer connection displaces it', async () => {
    const onDisplaced = vi.fn();
    const { connection, socket, sockets } = setup({ onDisplaced });
    active = connection;
    await connection.start();

    socket().serverSend({
      body: { event: { eventtype: 'disconnected_event' } },
      cmd: WECOM_CMD.EVENT_CALLBACK,
      headers: { req_id: 'evt-x' },
    });
    await flush();

    expect(onDisplaced).toHaveBeenCalledTimes(1);
    expect(connection.isDisplaced).toBe(true);
    expect(connection.isConnected).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sockets).toHaveLength(1);
  });

  it('reconnects after an unexpected close', async () => {
    const { connection, socket, sockets } = setup({ maxReconnectDelayMs: 5 });
    active = connection;
    await connection.start();

    socket().close(1006, 'network');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sockets).toHaveLength(2);
    expect(connection.isConnected).toBe(true);
  });

  it('sends heartbeats and reconnects when two in a row go unanswered', async () => {
    const { connection, socket, sockets } = setup({
      heartbeatIntervalMs: 10,
      maxReconnectDelayMs: 5,
    });
    active = connection;
    await connection.start();
    socket().ackFor = (frame) => (frame.cmd === WECOM_CMD.HEARTBEAT ? undefined : { errcode: 0 });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sockets[0].sentWith(WECOM_CMD.HEARTBEAT).length).toBeGreaterThanOrEqual(2);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });

  it('stops when the abort signal fires', async () => {
    const abort = new AbortController();
    const { connection, socket } = setup({ abortSignal: abort.signal });
    active = connection;
    await connection.start();
    abort.abort();
    expect(connection.isConnected).toBe(false);
    expect(socket().readyState).toBe(3);
  });
});

describe('truncateUtf8', () => {
  it('keeps short text and cuts long text on a character boundary', () => {
    expect(truncateUtf8('短', 10)).toBe('短');
    const cut = truncateUtf8('一二三四五六', 10);
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(10);
    expect(cut.endsWith('…')).toBe(true);
  });
});
