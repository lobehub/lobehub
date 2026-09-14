// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRedisCollaborationRoomBackend } from './roomBackend';

const redisMock = vi.hoisted(() => ({
  evalCalls: [] as unknown[][],
  values: new Map<string, string>(),
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'ready';

    constructor(..._args: unknown[]) {}

    duplicate() {
      return new FakeRedis();
    }

    on(_event: string, _listener: (...args: unknown[]) => void) {
      return this;
    }

    async ping() {
      return 'PONG';
    }

    async get(key: string) {
      return redisMock.values.get(key) ?? null;
    }

    async set(key: string, value: string, ...args: unknown[]) {
      if (args.includes('NX') && redisMock.values.has(key)) return null;
      redisMock.values.set(key, value);
      return 'OK';
    }

    async pexpire() {
      return 1;
    }

    async eval(...args: unknown[]) {
      redisMock.evalCalls.push(args);
      return 1;
    }

    async publish() {
      return 1;
    }

    async subscribe() {
      return 1;
    }

    async unsubscribe() {
      return 1;
    }

    async quit() {
      return 'OK';
    }
  }

  return { default: FakeRedis };
});

describe('Redis collaboration room presence command contract', () => {
  beforeEach(() => {
    redisMock.evalCalls.length = 0;
    redisMock.values.clear();
  });

  it('passes the presence Lua arguments in the declared order', async () => {
    const backend = createRedisCollaborationRoomBackend({
      instanceId: 'presence-contract-test',
      leaseMs: 1_000,
      prefix: 'presence-contract-test',
      redisUrl: 'redis://unit-test',
      requireScope: true,
    });
    const scope = {
      documentId: 'presence-contract-room',
      roomId: 'presence-contract-room',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    };

    await backend.initialize();
    await backend.ensureRoom(scope);
    await expect(
      backend.reserveClient?.(scope, {
        clientId: 'browser-1',
        clientKind: 'browser',
        expiresAt: Date.now() + 60_000,
        maxClients: 1,
      }),
    ).resolves.toEqual({ accepted: true });

    const presenceEval = redisMock.evalCalls.find((call) =>
      String(call[0]).includes('local clientKind = ARGV[5]'),
    );
    expect(presenceEval).toBeDefined();
    expect(presenceEval?.slice(1, 5)).toEqual([
      1,
      expect.stringContaining('page-collaboration:presence:'),
      expect.any(String),
      'browser:browser-1',
    ]);
    expect(presenceEval?.[5]).toEqual(expect.any(String));
    expect(Number(presenceEval?.[5])).toBeGreaterThan(Date.now());
    expect(presenceEval?.[6]).toBe('1');
    expect(presenceEval?.[7]).toBe('browser');

    await backend.close();
  });

  it('serializes bootstrapReady and accepts a bootstrap envelope', async () => {
    const backend = createRedisCollaborationRoomBackend({
      instanceId: 'bootstrap-contract-test',
      leaseMs: 1_000,
      prefix: 'bootstrap-contract-test',
      redisUrl: 'redis://unit-test',
      requireScope: true,
    });
    const scope = {
      documentId: 'bootstrap-contract-room',
      roomId: 'bootstrap-contract-room',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    };
    await backend.initialize();
    await backend.ensureRoom(scope);
    await expect(
      backend.saveSnapshot(scope, {
        bootstrapReady: true,
        revision: 4,
        stateVector: new Uint8Array([1, 2]),
        update: new Uint8Array([3, 4]),
      }),
    ).resolves.toBe(true);
    const saveCall = redisMock.evalCalls.find((call) =>
      String(call[0]).includes("redis.call('SET', KEYS[2], ARGV[2]"),
    );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(String(saveCall?.[5]))).toMatchObject({
      bootstrapReady: true,
      revision: 4,
    });

    await expect(
      backend.publish(scope, {
        bootstrapReady: true,
        kind: 'bootstrap',
        messageId: 'bootstrap-message',
        origin: 'bootstrap-contract-test',
        revision: 4,
        sequence: 1,
        sender: 100,
        stateVector: Buffer.from([1, 2]).toString('base64'),
        update: Buffer.from([3, 4]).toString('base64'),
      }),
    ).resolves.toBeUndefined();
    await backend.close();
  });
});
