import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { ToolResultPayload } from '../ToolResultWaiter';
import { ToolResultWaiter } from '../ToolResultWaiter';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Minimal in-memory Redis stub that supports the subset used by ToolResultWaiter:
 * - multi-key `blpop(key1, key2, ..., timeoutSeconds)` on the blocking client,
 * - `pipeline().lpush().expire().exec()` on the producer.
 *
 * `blpop` resolves immediately if any of the passed keys has a value;
 * otherwise it registers a single multi-key waiter and sleeps with real
 * `setTimeout`. `lpush` wakes the first waiter that is interested in the key.
 */
function createMockRedisPair() {
  const lists = new Map<string, string[]>();
  const waiters: Array<{
    keys: string[];
    wake: (key: string, value: string) => void;
  }> = [];

  const tryDeliverFromLists = () => {
    for (let i = 0; i < waiters.length; i++) {
      const w = waiters[i];
      for (const key of w.keys) {
        const list = lists.get(key);
        if (list && list.length > 0) {
          const value = list.pop()!;
          waiters.splice(i, 1);
          w.wake(key, value);
          return true;
        }
      }
    }
    return false;
  };

  const lpush = (key: string, ...values: string[]): number => {
    const list = lists.get(key) ?? [];
    list.unshift(...values);
    lists.set(key, list);
    tryDeliverFromLists();
    return list.length;
  };

  const blockingClient = {
    blpop: vi.fn(async (...args: (string | number)[]) => {
      const timeoutSeconds = args.at(-1) as number;
      const keys = args.slice(0, -1) as string[];

      for (const key of keys) {
        const list = lists.get(key);
        if (list && list.length > 0) {
          const value = list.pop()!;
          return [key, value] as [string, string];
        }
      }

      return new Promise<[string, string] | null>((resolve) => {
        const w = {
          keys,
          wake: (key: string, value: string) => {
            clearTimeout(timer);
            resolve([key, value]);
          },
        };
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(w);
          if (idx >= 0) waiters.splice(idx, 1);
          resolve(null);
        }, timeoutSeconds * 1000);
        waiters.push(w);
      });
    }),
  } as unknown as Redis;

  const producingClient = {
    pipeline: vi.fn(() => {
      const ops: Array<() => void> = [];
      const chain: any = {
        exec: async () => {
          ops.forEach((op) => op());
          return [];
        },
        expire: (_key: string, _seconds: number) => chain,
        lpush: (key: string, value: string) => {
          ops.push(() => lpush(key, value));
          return chain;
        },
      };
      return chain;
    }),
  } as unknown as Redis;

  return { blockingClient, lpush, producingClient };
}

describe('ToolResultWaiter', () => {
  it('returns the parsed payload when a result is LPUSHed before BLPOP', async () => {
    const { blockingClient, lpush, producingClient } = createMockRedisPair();
    const payload: ToolResultPayload = {
      content: 'hello',
      success: true,
      toolCallId: 'call-1',
    };
    lpush('tool_result:call-1', JSON.stringify(payload));

    const waiter = new ToolResultWaiter(blockingClient, producingClient);
    const result = await waiter.waitForResult('call-1', 5000);
    expect(result).toEqual(payload);
  });

  it('returns the parsed payload when LPUSHed after BLPOP starts waiting', async () => {
    const { blockingClient, lpush, producingClient } = createMockRedisPair();
    const waiter = new ToolResultWaiter(blockingClient, producingClient);
    const payload: ToolResultPayload = {
      content: 'delayed',
      success: true,
      toolCallId: 'call-2',
    };

    const pending = waiter.waitForResult('call-2', 5000);
    await tick();
    lpush('tool_result:call-2', JSON.stringify(payload));

    await expect(pending).resolves.toEqual(payload);
  });

  it('returns null on timeout', async () => {
    const { blockingClient, producingClient } = createMockRedisPair();
    const waiter = new ToolResultWaiter(blockingClient, producingClient);

    const result = await waiter.waitForResult('call-timeout', 50);
    expect(result).toBeNull();
  });

  it('waitForResults aligns with input order and fills timeouts with null', async () => {
    const { blockingClient, lpush, producingClient } = createMockRedisPair();
    const waiter = new ToolResultWaiter(blockingClient, producingClient);

    lpush('tool_result:a', JSON.stringify({ content: 'A', success: true, toolCallId: 'a' }));
    lpush('tool_result:c', JSON.stringify({ content: 'C', success: true, toolCallId: 'c' }));

    const results = await waiter.waitForResults(['a', 'b', 'c'], 50);
    expect(results[0]?.content).toBe('A');
    expect(results[1]).toBeNull();
    expect(results[2]?.content).toBe('C');
  });

  it('waitForResults uses multi-key BLPOP (total latency ≈ one timeout, not N × timeout)', async () => {
    const { blockingClient, producingClient } = createMockRedisPair();
    const waiter = new ToolResultWaiter(blockingClient, producingClient);

    // None of the keys ever receive a value. In the old serial impl this
    // would take ~3s (1s clamp × 3 keys). The multi-key loop should finish
    // in roughly one clamped-timeout window.
    const start = Date.now();
    const results = await waiter.waitForResults(['x', 'y', 'z'], 50);
    const elapsed = Date.now() - start;

    expect(results).toEqual([null, null, null]);
    expect(elapsed).toBeLessThan(1500);
  });

  it('waitForResults wakes as results arrive and re-enters BLPOP with remaining keys', async () => {
    const { blockingClient, lpush, producingClient } = createMockRedisPair();
    const waiter = new ToolResultWaiter(blockingClient, producingClient);

    const pending = waiter.waitForResults(['a', 'b'], 5000);
    await tick();
    lpush('tool_result:a', JSON.stringify({ content: 'A', success: true, toolCallId: 'a' }));
    await tick();
    lpush('tool_result:b', JSON.stringify({ content: 'B', success: true, toolCallId: 'b' }));

    const results = await pending;
    expect(results[0]?.content).toBe('A');
    expect(results[1]?.content).toBe('B');
  });

  it('cancel() wakes a blocked BLPOP and returns null', async () => {
    const { blockingClient, producingClient } = createMockRedisPair();
    const waiter = new ToolResultWaiter(blockingClient, producingClient);

    const pending = waiter.waitForResult('call-cancel', 5000);
    await tick();
    await waiter.cancel('call-cancel');

    await expect(pending).resolves.toBeNull();
  });

  it('returns null when the stored value is not valid JSON', async () => {
    const { blockingClient, lpush, producingClient } = createMockRedisPair();
    lpush('tool_result:bad', 'not-json');

    const waiter = new ToolResultWaiter(blockingClient, producingClient);
    const result = await waiter.waitForResult('bad', 5000);
    expect(result).toBeNull();
  });
});
