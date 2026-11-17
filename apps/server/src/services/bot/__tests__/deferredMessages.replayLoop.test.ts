import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAgentRuntimeRedisClient = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: mockGetAgentRuntimeRedisClient,
}));

const { MAX_REPLAYS_PER_MESSAGE, deferBotMessages, replayDeferredBotMessages } =
  await import('../deferredMessages');
const { getOriginMessageId } = await import('../mergeMessages');

/** In-memory Redis with the list / hash commands the deferred queue uses. */
function createStatefulRedis() {
  const lists = new Map<string, string[]>();
  /** Set to lose every acknowledgement, the way a crash between the run and the `LREM` would. */
  const faults = { loseAcks: false };
  const hashes = new Map<string, Map<string, number>>();
  const list = (key: string) => {
    if (!lists.has(key)) lists.set(key, []);
    return lists.get(key)!;
  };
  const commands = {
    expire: () => 1,
    hincrby: (key: string, field: string, by: number) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const hash = hashes.get(key)!;
      const next = (hash.get(field) ?? 0) + by;
      hash.set(field, next);
      return next;
    },
    lrem: (key: string, count: number, value: string) => {
      const items = list(key);
      const index = items.indexOf(value);
      if (faults.loseAcks || count !== 1 || index === -1) return 0;
      items.splice(index, 1);
      return 1;
    },
    ltrim: (key: string, start: number, stop: number) => {
      const items = list(key);
      lists.set(
        key,
        items.slice(start < 0 ? Math.max(items.length + start, 0) : start, stop + 1 || undefined),
      );
      return 'OK';
    },
    rpush: (key: string, ...values: string[]) => list(key).push(...values),
  };
  return {
    faults,
    hmget: async (key: string, ...fields: string[]) =>
      fields.map((field) => {
        const count = hashes.get(key)?.get(field);
        return count === undefined ? null : String(count);
      }),
    lists,
    lrange: async (key: string) => [...list(key)],
    multi: () => {
      const queued: Array<() => unknown> = [];
      const chain: any = {
        exec: async () => queued.map((run) => [null, run()]),
      };
      for (const [name, run] of Object.entries(commands)) {
        chain[name] = (...args: any[]) => {
          queued.push(() => (run as (...a: any[]) => unknown)(...args));
          return chain;
        };
      }
      return chain;
    },
  };
}

const KEY = 'bot:deferred-messages:app-1:feishu:group:oc_1';

const asMessage = (id: string) =>
  ({ id, toJSON: () => ({ _type: 'chat:Message', id, text: 'build the tasks' }) }) as any;

describe('deferred replay loop', () => {
  let redis: ReturnType<typeof createStatefulRedis>;

  beforeEach(() => {
    redis = createStatefulRedis();
    mockGetAgentRuntimeRedisClient.mockReturnValue(redis);
  });

  /**
   * Production incident (feishu, 24 runs for one message): the completion callback replays a
   * parked message while its own run is still marked live, so the bridge parks the replay
   * again, sees the run gone on its post-enqueue recheck and replays the queue from inside the
   * outer replay. That inner read still holds the outer, unacknowledged copy: one copy starts a
   * run, the other finds the topic busy and is parked a third time. Every completion repeated it.
   */
  it('runs a message parked again by its own replay once and leaves nothing queued', async () => {
    await deferBotMessages('app-1', 'feishu:group:oc_1', [asMessage('om_1')]);

    const runs: string[] = [];
    let topicBusy = true; // the completing run has not released the topic yet

    const deliver = async (entries: { id: string }[]): Promise<void> => {
      for (const entry of entries) {
        const replayed = asMessage(`${getOriginMessageId(entry)}:replay:${Date.now()}:0`);
        if (topicBusy) {
          await deferBotMessages('app-1', 'feishu:group:oc_1', [replayed]);
          // Post-enqueue recheck: the run has settled by now, so the bridge replays at once.
          if (runs.length === 0 && topicBusy) {
            topicBusy = false;
            await replayDeferredBotMessages('app-1', 'feishu:group:oc_1', deliver);
          }
          continue;
        }
        runs.push(replayed.id);
        topicBusy = true; // the run it started owns the topic
      }
    };

    await replayDeferredBotMessages('app-1', 'feishu:group:oc_1', deliver);

    expect(runs).toHaveLength(1);
    expect(redis.lists.get(KEY)).toEqual([]);
  });

  it('collapses every queued copy of one message into a single replay', async () => {
    await deferBotMessages('app-1', 'feishu:group:oc_1', [
      asMessage('om_1'),
      asMessage('om_2'),
      asMessage('om_1:replay:100:0'),
    ]);
    const replay = vi.fn().mockResolvedValue(undefined);

    await replayDeferredBotMessages('app-1', 'feishu:group:oc_1', replay);

    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay.mock.calls[0][0].map((entry: { id: string }) => entry.id)).toEqual([
      'om_1:replay:100:0',
      'om_2',
    ]);
    expect(redis.lists.get(KEY)).toEqual([]);
  });

  it('drops a message once it has been run the maximum number of times', async () => {
    // A loop the collapse cannot see: every lap runs the message, and it is never removed.
    redis.faults.loseAcks = true;
    await deferBotMessages('app-1', 'feishu:group:oc_1', [asMessage('om_1')]);
    const replay = vi.fn().mockResolvedValue(undefined);

    for (let round = 0; round < MAX_REPLAYS_PER_MESSAGE + 2; round++) {
      await replayDeferredBotMessages('app-1', 'feishu:group:oc_1', replay);
    }

    expect(replay).toHaveBeenCalledTimes(MAX_REPLAYS_PER_MESSAGE);
  });

  it('keeps the budget of messages parked again while other senders take the runs', async () => {
    const senders = ['om_a', 'om_b', 'om_c', 'om_d', 'om_e'];
    await deferBotMessages('app-1', 'feishu:group:oc_1', senders.map(asMessage));
    const runs: string[] = [];

    // Each completion drains the queue: one sender's message starts the run, and every other
    // sender's message finds the topic busy and is parked again under a replay id.
    const deliver = async (entries: { id: string }[]): Promise<void> => {
      const [first, ...rest] = entries;
      runs.push(getOriginMessageId(first));
      await deferBotMessages(
        'app-1',
        'feishu:group:oc_1',
        rest.map((entry) => asMessage(`${getOriginMessageId(entry)}:replay:${runs.length}:0`)),
      );
    };

    for (let completion = 0; completion < senders.length + 2; completion++) {
      await replayDeferredBotMessages('app-1', 'feishu:group:oc_1', deliver);
    }

    expect(runs).toEqual(senders);
    expect(redis.lists.get(KEY)).toEqual([]);
  });

  it('does not spend the budget on deliveries that fail before the SDK takes the message', async () => {
    await deferBotMessages('app-1', 'feishu:group:oc_1', [asMessage('om_1')]);
    const replay = vi.fn().mockRejectedValue(new Error('Bot adapter unavailable for feishu'));

    // More failed attempts than the budget allows (the retry job schedules up to eight).
    for (let attempt = 0; attempt < MAX_REPLAYS_PER_MESSAGE + 2; attempt++) {
      await expect(replayDeferredBotMessages('app-1', 'feishu:group:oc_1', replay)).rejects.toThrow(
        'Bot adapter unavailable',
      );
    }
    replay.mockResolvedValueOnce(undefined);
    await replayDeferredBotMessages('app-1', 'feishu:group:oc_1', replay);

    expect(replay).toHaveBeenCalledTimes(MAX_REPLAYS_PER_MESSAGE + 3);
    expect(replay.mock.lastCall?.[0].map((entry: { id: string }) => entry.id)).toEqual(['om_1']);
    expect(redis.lists.get(KEY)).toEqual([]);
  });
});
