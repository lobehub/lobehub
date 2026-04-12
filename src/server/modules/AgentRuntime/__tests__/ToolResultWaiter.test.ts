import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { ToolResultPayload } from '../ToolResultWaiter';
import { ToolResultWaiter } from '../ToolResultWaiter';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Minimal in-memory Redis stub that supports the subset used by ToolResultWaiter
 * (`blpop` on the blocking client, `pipeline().lpush().expire().exec()` on the
 * producer). `blpop` resolves immediately if a value is queued; otherwise it
 * waits using real `setTimeout` and is woken by `lpush`.
 */
function createMockRedisPair() {
  const lists = new Map<string, string[]>();
  const waiters = new Map<string, Array<(value: string) => void>>();

  const lpush = (key: string, ...values: string[]): number => {
    const list = lists.get(key) ?? [];
    list.unshift(...values);
    lists.set(key, list);
    const pending = waiters.get(key) ?? [];
    while (pending.length > 0 && list.length > 0) {
      const wake = pending.shift()!;
      const popped = list.pop()!;
      wake(popped);
    }
    waiters.set(key, pending);
    return list.length;
  };

  const blockingClient = {
    blpop: vi.fn(async (key: string, timeoutSeconds: number) => {
      const list = lists.get(key);
      if (list && list.length > 0) {
        const value = list.pop()!;
        return [key, value] as [string, string];
      }
      return new Promise<[string, string] | null>((resolve) => {
        const pending = waiters.get(key) ?? [];
        const wake = (value: string) => {
          clearTimeout(timer);
          resolve([key, value]);
        };
        const timer = setTimeout(() => {
          const queue = waiters.get(key) ?? [];
          const idx = queue.indexOf(wake);
          if (idx >= 0) queue.splice(idx, 1);
          resolve(null);
        }, timeoutSeconds * 1000);
        pending.push(wake);
        waiters.set(key, pending);
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

    // BLPOP timeout is clamped to min 1 second, so pass 50ms → waits ~1s.
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
