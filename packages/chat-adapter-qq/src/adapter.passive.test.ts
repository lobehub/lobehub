import type { StateAdapter } from 'chat';
import { Chat } from 'chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQQAdapter } from './adapter';
import { QQ_DEFERRED_PREFIX } from './passive';
import { QQ_EVENT_TYPES, QQ_OP_CODES } from './types';

/** Minimal in-memory `StateAdapter`; production wires ioredis. */
const createMemoryState = (): StateAdapter => {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const queues = new Map<string, unknown[]>();
  const subscribed = new Set<string>();

  return {
    acquireLock: async (threadId) => ({ expiresAt: Number.MAX_SAFE_INTEGER, threadId, token: 't' }),
    appendToList: async (key, value) => {
      lists.set(key, [...(lists.get(key) ?? []), value]);
    },
    connect: async () => {},
    delete: async (key) => {
      values.delete(key);
    },
    dequeue: async (threadId) => (queues.get(threadId)?.shift() as any) ?? null,
    disconnect: async () => {},
    enqueue: async (threadId, entry) => {
      const queue = [...(queues.get(threadId) ?? []), entry];
      queues.set(threadId, queue);
      return queue.length;
    },
    extendLock: async () => true,
    forceReleaseLock: async () => {},
    get: async <T,>(key: string) => (values.get(key) ?? null) as T | null,
    getList: async <T,>(key: string) => (lists.get(key) ?? []) as T[],
    isSubscribed: async (threadId) => subscribed.has(threadId),
    queueDepth: async (threadId) => queues.get(threadId)?.length ?? 0,
    releaseLock: async () => {},
    set: async (key, value) => {
      values.set(key, value);
    },
    setIfNotExists: async (key, value) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    subscribe: async (threadId) => {
      subscribed.add(threadId);
    },
    unsubscribe: async (threadId) => {
      subscribed.delete(threadId);
    },
  };
};

const SEND_PATH = '/v2/groups/group_1/messages';

/** QQ's auth and bot-info endpoints; send calls are recorded so the body can be asserted. */
const stubQQHttp = ({ activeLimited = false }: { activeLimited?: boolean } = {}) => {
  const sent: Array<Record<string, any>> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      const json = { 'content-type': 'application/json' };

      if (url.includes(SEND_PATH)) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        sent.push(body);
        // `activeLimited` mimics QQ's frequency cap: an uncoupled send is refused.
        if (activeLimited && !body.msg_id) {
          return new Response(
            JSON.stringify({ code: 40034100, message: '主动消息发送超过频控限制' }),
            { headers: json, status: 403 },
          );
        }
        return new Response(JSON.stringify({ id: `sent_${sent.length}`, timestamp: 'now' }), {
          headers: json,
          status: 200,
        });
      }
      if (url.includes('getAppAccessToken')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 }), {
          headers: json,
          status: 200,
        });
      }
      if (url.endsWith('/users/@me')) {
        return new Response(JSON.stringify({ id: 'BOT_USER_ID', username: 'qq-bot' }), {
          headers: json,
          status: 200,
        });
      }

      return new Response('{}', { headers: json, status: 200 });
    }),
  );

  return sent;
};

const makeRequest = (body: unknown) =>
  new Request('http://localhost/webhook', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

const inbound = (msgId: string, content = '帮我看看') => ({
  d: {
    author: { id: 'user_1' },
    content,
    group_openid: 'group_1',
    id: msgId,
    timestamp: '2026-11-12T10:00:00Z',
  },
  id: `event_${msgId}`,
  op: QQ_OP_CODES.DISPATCH,
  t: QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE,
});

describe('QQ passive replies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setup = async () => {
    const sent = stubQQHttp();
    const adapter = createQQAdapter({ appId: 'app', clientSecret: 'secret' });
    const chat = new Chat({
      adapters: { qq: adapter },
      state: createMemoryState(),
      userName: 'qq-bot',
    });
    await chat.initialize();

    return { adapter, sent };
  };

  it('answers inside the inbound message\'s window', async () => {
    const { adapter, sent } = await setup();
    await adapter.handleWebhook(makeRequest(inbound('msg_1')));

    await adapter.postMessage('qq:group:group_1', '答案是 42');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ content: '答案是 42', msg_id: 'msg_1', msg_seq: 1 });
  });

  it('numbers every reply in one window', async () => {
    const { adapter, sent } = await setup();
    await adapter.handleWebhook(makeRequest(inbound('msg_1')));

    await adapter.postMessage('qq:group:group_1', 'a');
    await adapter.postMessage('qq:group:group_1', 'b');

    expect(sent.map((body) => body.msg_seq)).toEqual([1, 2]);
  });

  it('falls back to an active message once the five replies are spent', async () => {
    const { adapter, sent } = await setup();
    await adapter.handleWebhook(makeRequest(inbound('msg_1')));
    for (let i = 0; i < 5; i++) {
      await adapter.postMessage('qq:group:group_1', `chunk ${i}`);
    }

    await adapter.postMessage('qq:group:group_1', '最后一段');

    // Still delivered — QQ accepts active messages, it only rate limits them.
    expect(sent).toHaveLength(6);
    expect(sent[5].content).toBe('最后一段');
    expect(sent[5].msg_id).toBeUndefined();
    expect(sent[5].msg_seq).toBeUndefined();
  });

  it('parks the text when the active quota is exhausted too, and delivers it on the next message', async () => {
    const sent = stubQQHttp({ activeLimited: true });
    const adapter = createQQAdapter({ appId: 'app', clientSecret: 'secret' });
    const chat = new Chat({
      adapters: { qq: adapter },
      state: createMemoryState(),
      userName: 'qq-bot',
    });
    await chat.initialize();

    await adapter.handleWebhook(makeRequest(inbound('msg_1')));
    for (let i = 0; i < 5; i++) {
      await adapter.postMessage('qq:group:group_1', `chunk ${i}`);
    }

    const before = sent.length;
    await adapter.postMessage('qq:group:group_1', '最后一段');

    expect(sent.length).toBe(before + 1);

    await adapter.handleWebhook(makeRequest(inbound('msg_2')));

    // Passive again: the parked text goes out first, on the new window.
    expect(sent.at(-1)).toMatchObject({
      content: `${QQ_DEFERRED_PREFIX}最后一段`,
      msg_id: 'msg_2',
      msg_seq: 1,
    });
  });

  it('sends nothing for a thread that never received an inbound message', async () => {
    const { adapter, sent } = await setup();

    await adapter.postMessage('qq:group:never_seen', 'hello');

    expect(sent).toHaveLength(0);
  });
});
