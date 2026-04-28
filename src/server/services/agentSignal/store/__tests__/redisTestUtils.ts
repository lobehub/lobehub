import { createSource } from '@lobechat/agent-signal';
import { vi } from 'vitest';

export interface AgentSignalRedisTestGlobal {
  __agentSignalRedisClient?: typeof mockRedis | null;
}

type HashState = Map<string, Record<string, string>>;
type ListState = Map<string, string[]>;

export const hashes: HashState = new Map();
export const lists: ListState = new Map();

const cloneHash = (value?: Record<string, string>) => {
  return value ? { ...value } : {};
};

const getListSlice = (key: string, start: number, stop: number) => {
  const current = [...(lists.get(key) ?? [])];
  const normalizedStop = stop < 0 ? current.length + stop + 1 : stop + 1;

  return current.slice(start, normalizedStop);
};

const applyHashWrite = (key: string, payload: Record<string, string>) => {
  const current = hashes.get(key) ?? {};
  hashes.set(key, { ...current, ...payload });
};

export const resetRedisState = () => {
  hashes.clear();
  lists.clear();
};

const queuedExecResults: Array<Array<readonly [null, 'OK']> | null | undefined> = [];

const createMockRedisClient = () => {
  return {
    del: vi.fn(),
    duplicate: vi.fn(),
    expire: vi.fn(),
    hdel: vi.fn(),
    hgetall: vi.fn(),
    hset: vi.fn(),
    lrange: vi.fn(),
    multi: vi.fn(),
    quit: vi.fn(),
    rpush: vi.fn(),
    set: vi.fn(),
    unwatch: vi.fn(),
    watch: vi.fn(),
  };
};

export const mockRedis = createMockRedisClient();
const casClients: Array<typeof mockRedis> = [];

const installRedisClientBehavior = (client: typeof mockRedis) => {
  client.del.mockImplementation(async (key: string) => {
    const removed = Number(hashes.delete(key)) + Number(lists.delete(key));
    return removed;
  });
  client.expire.mockImplementation(async () => 1);
  client.hdel.mockImplementation(async (key: string, ...fields: string[]) => {
    const current = hashes.get(key) ?? {};

    for (const field of fields) {
      delete current[field];
    }

    hashes.set(key, current);

    return fields.length;
  });
  client.hgetall.mockImplementation(async (key: string) => {
    return cloneHash(hashes.get(key));
  });
  client.hset.mockImplementation(async (key: string, payload: Record<string, string>) => {
    applyHashWrite(key, payload);
    return Object.keys(payload).length;
  });
  client.lrange.mockImplementation(async (key: string, start: number, stop: number) => {
    return getListSlice(key, start, stop);
  });
  client.rpush.mockImplementation(async (key: string, ...values: string[]) => {
    const current = [...(lists.get(key) ?? []), ...values];
    lists.set(key, current);

    return current.length;
  });
  client.watch.mockImplementation(async () => 'OK');
  client.unwatch.mockImplementation(async () => 'OK');
  client.quit.mockImplementation(async () => 'OK');
  client.multi.mockImplementation(() => {
    const commands: Array<() => void> = [];

    const chain = {
      exec: vi.fn(async () => {
        const queued = queuedExecResults.shift();

        if (queued === null) {
          return null;
        }

        for (const command of commands) {
          command();
        }

        return queued ?? commands.map(() => [null, 'OK'] as const);
      }),
      expire(key: string, ttlSeconds: number) {
        commands.push(() => {
          void ttlSeconds;
        });
        commands.push(() => {
          void key;
        });
        return chain;
      },
      hdel(key: string, ...fields: string[]) {
        commands.push(() => {
          const current = hashes.get(key) ?? {};

          for (const field of fields) {
            delete current[field];
          }

          hashes.set(key, current);
        });
        return chain;
      },
      hset(key: string, payload: Record<string, string>) {
        commands.push(() => {
          applyHashWrite(key, payload);
        });
        return chain;
      },
      rpush(key: string, value: string) {
        commands.push(() => {
          const current = [...(lists.get(key) ?? []), value];
          lists.set(key, current);
        });
        return chain;
      },
    };

    return chain;
  });
};

export const installStatefulRedisMock = () => {
  casClients.length = 0;
  queuedExecResults.length = 0;
  installRedisClientBehavior(mockRedis);
  mockRedis.duplicate.mockImplementation(() => {
    const client = createMockRedisClient();
    installRedisClientBehavior(client);
    casClients.push(client);

    return client as never;
  });
};

export const queueExecConflict = (count = 1) => {
  for (let index = 0; index < count; index++) {
    queuedExecResults.push(null);
  }
};

export const lastCasClient = () => {
  return casClients.at(-1);
};

export const source = createSource({
  payload: { message: 'remember this' },
  scope: { topicId: 'topic-1', userId: 'user-1' },
  scopeKey: 'topic:topic-1',
  sourceType: 'source.user.message',
  timestamp: 1_000,
});

export const secondSource = createSource({
  payload: { message: 'remember this next' },
  scope: { topicId: 'topic-1', userId: 'user-1' },
  scopeKey: 'topic:topic-1',
  sourceType: 'source.user.message',
  timestamp: 2_000,
});
