import type { StateAdapter } from 'chat';
import { Chat } from 'chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQQAdapter } from './adapter';
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

/** QQ's auth + bot-info endpoints; everything else is never reached in these tests. */
const stubQQHttp = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      const url = String(input);
      const json = { 'content-type': 'application/json' };
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
};

const makeRequest = (body: unknown) =>
  new Request('http://localhost/webhook', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

const dispatch = (t: string, d: Record<string, any>) => ({
  d: {
    author: { id: 'user_1' },
    content: '帮我看看这个',
    group_openid: 'group_1',
    id: 'msg_1',
    timestamp: '2026-11-12T10:00:00Z',
    ...d,
  },
  id: 'event_1',
  op: QQ_OP_CODES.DISPATCH,
  t,
});

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for handler');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('QQ group @-mention routing (real chat-sdk)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires onNewMention for GROUP_AT_MESSAGE_CREATE', async () => {
    stubQQHttp();

    const adapter = createQQAdapter({ appId: 'app', clientSecret: 'secret' });
    const chat = new Chat({ adapters: { qq: adapter }, state: createMemoryState(), userName: 'qq-bot' });
    await chat.initialize();

    const seen: string[] = [];
    chat.onNewMention(async (_thread, message) => {
      seen.push(message.text);
    });

    await adapter.handleWebhook(makeRequest(dispatch(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {})));
    await waitFor(() => seen.length === 1);

    // The @ marker itself is stripped from a group message's content by QQ — the text the agent
    // sees is the bare question.
    expect(seen[0]).toBe('帮我看看这个');
  });

  it('does not treat a c2c message as an @-mention event type but still reaches a DM handler', async () => {
    stubQQHttp();

    const adapter = createQQAdapter({ appId: 'app', clientSecret: 'secret' });
    const chat = new Chat({ adapters: { qq: adapter }, state: createMemoryState(), userName: 'qq-bot' });
    await chat.initialize();

    let mentions = 0;
    let dms = 0;
    chat.onNewMention(async () => {
      mentions += 1;
    });
    chat.onDirectMessage(async () => {
      dms += 1;
    });

    await adapter.handleWebhook(
      makeRequest(
        dispatch(QQ_EVENT_TYPES.C2C_MESSAGE_CREATE, { group_openid: undefined }),
      ),
    );
    await waitFor(() => dms === 1);

    expect(mentions).toBe(0);
  });
});
