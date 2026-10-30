import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    client: {
      exists: async (key: string) => Number(values.has(key)),
      setex: async (key: string, _ttl: number, value: string) => {
        values.set(key, value);
        return 'OK';
      },
    },
  };
});

vi.mock('@/envs/app', () => ({ appEnv: { enableQueueAgentRuntime: false } }));
vi.mock('./redis', () => ({ getAgentRuntimeRedisClient: () => transport.client }));
vi.mock('./GatewayStreamNotifier', () => ({ GatewayStreamNotifier: vi.fn() }));

// Separate module graphs represent independent inline runtime instances. Only
// the Redis transport boundary is replaced; both factories and managers are real.
describe('inline runtime shared interruption state', () => {
  beforeEach(() => {
    vi.resetModules();
    transport.values.clear();
  });

  it('observes an interruption written by another factory instance', async () => {
    const first = (await import('./factory')).createAgentStateManager();
    vi.resetModules();
    const second = (await import('./factory')).createAgentStateManager();

    expect(first).not.toBe(second);
    expect(await first.isInterrupted('shared-run')).toBe(false);
    await second.markInterrupted('shared-run');
    expect(await first.isInterrupted('shared-run')).toBe(true);
    expect(await first.isInterrupted('unrelated-run')).toBe(false);
  });
});
