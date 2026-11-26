import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAgentRuntimeRedisClient = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: mockGetAgentRuntimeRedisClient,
}));

// No `redisService` connection: the replay budget fails open, as it does without Redis.
vi.mock('@/server/services/redis/client', () => ({ getRedisServiceClient: async () => null }));

const {
  buildDeferredMessagesKey,
  deferBotMessages,
  readDeferredBotMessages,
  replayDeferredBotMessages,
  isDeferredMessagesAvailable,
} = await import('../deferredMessages');

/** Minimal ioredis `multi()` chain recorder. */
function createRedis(execResult: unknown = []) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: any = {};
  for (const cmd of ['rpush', 'ltrim', 'expire', 'lrem']) {
    chain[cmd] = vi.fn((...args: unknown[]) => {
      calls.push([cmd, ...args]);
      return chain;
    });
  }
  chain.exec = vi.fn().mockResolvedValue(execResult);
  return {
    calls,
    chain,
    lrange: vi.fn().mockResolvedValue([]),
    multi: vi.fn(() => chain),
  };
}

const makeMessage = (id: string) => ({ id, toJSON: () => ({ _type: 'chat:Message', id }) }) as any;

/**
 * Stateful in-memory stand-in for the ioredis subset the deferred queue uses
 * (lists, `SET … NX`, `GET`, `DEL`, and `MULTI` that applies queued commands
 * in order), so a test can follow an entry across several replays.
 */
function createStatefulRedis() {
  const lists = new Map<string, string[]>();
  const strings = new Map<string, string>();
  const ops: Record<string, (...args: any[]) => unknown> = {
    del: (...keys: string[]) => keys.filter((key) => strings.delete(key)).length,
    expire: () => 1,
    get: (key: string) => strings.get(key) ?? null,
    lrange: (key: string) => [...(lists.get(key) ?? [])],
    lrem: (key: string, count: number, value: string) => {
      const list = lists.get(key) ?? [];
      let removed = 0;
      lists.set(
        key,
        list.filter((item) => {
          if (removed < count && item === value) {
            removed += 1;
            return false;
          }
          return true;
        }),
      );
      return removed;
    },
    ltrim: (key: string, start: number) => {
      lists.set(key, (lists.get(key) ?? []).slice(start));
      return 'OK';
    },
    rpush: (key: string, ...values: string[]) => {
      const list = [...(lists.get(key) ?? []), ...values];
      lists.set(key, list);
      return list.length;
    },
    set: (key: string, value: string, ...flags: unknown[]) => {
      if (flags.includes('NX') && strings.has(key)) return null;
      strings.set(key, value);
      return 'OK';
    },
  };
  const multi = () => {
    const queued: Array<() => unknown> = [];
    const chain: any = {
      exec: vi.fn(async () => queued.map((run) => [null, run()])),
    };
    for (const [name, op] of Object.entries(ops)) {
      chain[name] = (...args: unknown[]) => {
        queued.push(() => op(...args));
        return chain;
      };
    }
    return chain;
  };
  const client: any = { multi: vi.fn(multi) };
  for (const [name, op] of Object.entries(ops))
    client[name] = vi.fn(async (...args) => op(...args));
  return { client, lists, strings };
}

/**
 * Mirrors what the Feishu client's `extractFiles` does to a reply: it writes
 * the quoted message onto `message.raw.referenced_message` in place.
 */
const resolveQuoteInPlace = (entries: any[]) => {
  for (const entry of entries) {
    entry.raw.referenced_message = { author: { username: 'Calvin' }, content: 'sheet link' };
  }
};

const QUOTED_REPLY = {
  _type: 'chat:Message',
  author: { userId: 'ou_1', userName: 'Wenbing' },
  id: 'om_reply',
  raw: { message_id: 'om_reply', parent_id: 'om_parent' },
  text: 'can you create the tasks?',
};

describe('deferredMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a key scoped by application and thread', () => {
    expect(buildDeferredMessagesKey('app-1', 'wechat:single:u')).toBe(
      'bot:deferred-messages:app-1:wechat:single:u',
    );
  });

  it('reports unavailable and stores nothing without Redis', async () => {
    mockGetAgentRuntimeRedisClient.mockReturnValue(null);

    expect(isDeferredMessagesAvailable()).toBe(false);
    await expect(deferBotMessages('app-1', 't', [makeMessage('1')])).resolves.toBe(false);
    await expect(readDeferredBotMessages('app-1', 't')).resolves.toEqual([]);
  });

  it('appends serialized messages in order with a cap and TTL', async () => {
    const redis = createRedis();
    mockGetAgentRuntimeRedisClient.mockReturnValue(redis);

    const ok = await deferBotMessages('app-1', 't', [makeMessage('1'), makeMessage('2')]);

    expect(ok).toBe(true);
    expect(redis.calls[0]).toEqual([
      'rpush',
      'bot:deferred-messages:app-1:t',
      JSON.stringify({ _type: 'chat:Message', id: '1' }),
      JSON.stringify({ _type: 'chat:Message', id: '2' }),
    ]);
    expect(redis.calls[1]).toEqual(['ltrim', 'bot:deferred-messages:app-1:t', -20, -1]);
    expect(redis.calls[2]).toEqual(['expire', 'bot:deferred-messages:app-1:t', 30 * 60]);
  });

  it('returns false when the write fails so callers keep the fallback path', async () => {
    const redis = createRedis();
    redis.chain.exec.mockRejectedValue(new Error('boom'));
    mockGetAgentRuntimeRedisClient.mockReturnValue(redis);

    await expect(deferBotMessages('app-1', 't', [makeMessage('1')])).resolves.toBe(false);
  });

  it('reads oldest-first without removing entries and skips corrupt payloads', async () => {
    const redis = createRedis();
    redis.lrange.mockResolvedValue(['{"id":"1"}', 'not json', '{"id":"2"}']);
    mockGetAgentRuntimeRedisClient.mockReturnValue(redis);
    expect(await readDeferredBotMessages('app-1', 't')).toEqual([{ id: '1' }, { id: '2' }]);
    expect(redis.calls).toEqual([]);
  });

  it('retains the full batch when replay fails, then acknowledges only those entries on retry', async () => {
    const redis = createStatefulRedis();
    const key = 'bot:deferred-messages:app-1:t';
    redis.lists.set(key, ['{"id":"1"}', '{"id":"2"}']);
    mockGetAgentRuntimeRedisClient.mockReturnValue(redis.client);
    const replay = vi
      .fn()
      .mockRejectedValueOnce(new Error('adapter unavailable'))
      .mockImplementationOnce(async () => {
        // A follow-up parked while the retry dispatches belongs to the next pass.
        redis.lists.get(key)!.push('{"id":"3"}');
      });
    await expect(replayDeferredBotMessages('app-1', 't', replay)).rejects.toThrow(
      'adapter unavailable',
    );
    expect(redis.lists.get(key)).toEqual(['{"id":"1"}', '{"id":"2"}']);
    await replayDeferredBotMessages('app-1', 't', replay);
    expect(replay).toHaveBeenNthCalledWith(2, [{ id: '1' }, { id: '2' }]);
    expect(redis.lists.get(key)).toEqual(['{"id":"3"}']);
  });

  describe('replay idempotency', () => {
    const KEY = 'bot:deferred-messages:app-1:t';

    const parkQuotedReply = async (redis: ReturnType<typeof createStatefulRedis>) => {
      mockGetAgentRuntimeRedisClient.mockReturnValue(redis.client);
      await deferBotMessages('app-1', 't', [
        { id: QUOTED_REPLY.id, toJSON: () => QUOTED_REPLY },
      ] as any);
    };

    it('removes an entry the replay mutated in place, so the next completion does not replay it again', async () => {
      const redis = createStatefulRedis();
      await parkQuotedReply(redis);
      const replay = vi.fn(async (entries: any[]) => resolveQuoteInPlace(entries));

      await replayDeferredBotMessages('app-1', 't', replay);
      // The run started by that replay completes and its callback replays again.
      await replayDeferredBotMessages('app-1', 't', replay);

      expect(replay).toHaveBeenCalledTimes(1);
      expect(redis.lists.get(KEY)).toEqual([]);
    });

    it('skips and removes an entry that was already replayed when its acknowledgement was lost', async () => {
      const redis = createStatefulRedis();
      await parkQuotedReply(redis);
      const parked = [...redis.lists.get(KEY)!];
      const replay = vi.fn().mockResolvedValue(undefined);
      await replayDeferredBotMessages('app-1', 't', replay);
      // Simulate the ack never reaching Redis (crash, or a retried replay job).
      redis.lists.set(KEY, parked);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await replayDeferredBotMessages('app-1', 't', replay);

      expect(replay).toHaveBeenCalledTimes(1);
      expect(redis.lists.get(KEY)).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('skipped 1 already-replayed deferred message(s)'),
        expect.objectContaining({ applicationId: 'app-1', messageIds: ['om_reply'] }),
      );
      warn.mockRestore();
    });

    it('leaves an entry that another replay is still dispatching to that replay', async () => {
      const redis = createStatefulRedis();
      await parkQuotedReply(redis);
      let releaseFirst!: () => void;
      const firstDispatch = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const replay = vi.fn().mockReturnValueOnce(firstDispatch).mockResolvedValue(undefined);

      const first = replayDeferredBotMessages('app-1', 't', replay);
      await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(1));
      // The post-enqueue recheck in `deferWhileTopicBusy` can start a second
      // replay while the completion callback's replay is still dispatching.
      await replayDeferredBotMessages('app-1', 't', replay);
      releaseFirst();
      await first;

      expect(replay).toHaveBeenCalledTimes(1);
      expect(redis.lists.get(KEY)).toEqual([]);
    });

    it('releases the claim when replay fails so the retry dispatches the entry again', async () => {
      const redis = createStatefulRedis();
      await parkQuotedReply(redis);
      const replay = vi
        .fn()
        .mockRejectedValueOnce(new Error('adapter unavailable'))
        .mockResolvedValueOnce(undefined);

      await expect(replayDeferredBotMessages('app-1', 't', replay)).rejects.toThrow(
        'adapter unavailable',
      );
      expect(redis.lists.get(KEY)).toHaveLength(1);
      await replayDeferredBotMessages('app-1', 't', replay);

      expect(replay).toHaveBeenCalledTimes(2);
      expect(redis.lists.get(KEY)).toEqual([]);
    });
  });

  it('reports Redis transaction errors as a failed write', async () => {
    mockGetAgentRuntimeRedisClient.mockReturnValue(createRedis([[new Error('read only'), null]]));
    await expect(deferBotMessages('app-1', 't', [makeMessage('1')])).resolves.toBe(false);
  });
});
