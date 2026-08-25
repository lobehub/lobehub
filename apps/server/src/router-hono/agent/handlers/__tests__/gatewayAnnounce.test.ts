// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gatewayAnnounce } from '../gatewayAnnounce';

const mockEnv = vi.hoisted(() => ({
  MESSAGE_GATEWAY_ENABLED: '1' as string | undefined,
  MESSAGE_GATEWAY_SERVICE_TOKEN: 'shared-token' as string | undefined,
}));
const mockReconcileHost = vi.hoisted(() => vi.fn());
const mockRedis = vi.hoisted(() => ({
  client: null as null | {
    eval: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    ttl: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('@/envs/gateway', () => ({ gatewayEnv: mockEnv }));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => mockRedis.client,
}));
vi.mock('@/server/services/gateway', () => ({
  GatewayService: class {
    reconcileHost = mockReconcileHost;
  },
}));

const call = async (body: unknown, token = 'shared-token') => {
  const headers = new Map<string, string>([['authorization', `Bearer ${token}`]]);
  const res: Record<string, string> = {};
  const c = {
    body: (_b: null, status: number) => ({ status, json: async () => null }),
    header: (k: string, v: string) => (res[k] = v),
    json: (payload: unknown, status = 200) => ({ headers: res, payload, status }),
    req: { header: (k: string) => headers.get(k), json: async () => body },
  };
  return (await gatewayAnnounce(c as never)) as unknown as {
    headers: Record<string, string>;
    payload: Record<string, unknown>;
    status: number;
  };
};

describe('gatewayAnnounce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.MESSAGE_GATEWAY_ENABLED = '1';
    mockEnv.MESSAGE_GATEWAY_SERVICE_TOKEN = 'shared-token';
    mockRedis.client = null;
    mockReconcileHost.mockResolvedValue({ connected: 3, failed: 0, ok: true });
  });

  it('rebuilds only the announcing host', async () => {
    const r = await call({ host: 'node', reason: 'process start' });

    expect(r.status).toBe(200);
    expect(mockReconcileHost).toHaveBeenCalledWith('node');
  });

  it('rejects a wrong token', async () => {
    const r = await call({ host: 'node' }, 'nope');

    expect(r.status).toBe(401);
    expect(mockReconcileHost).not.toHaveBeenCalled();
  });

  it('reports a failed rebuild as retryable instead of claiming success', async () => {
    // The gateway is sitting on an empty registry; telling it "done" here is
    // how a transient database blip turns into an outage lasting until the
    // periodic reconcile.
    mockReconcileHost.mockRejectedValue(new Error('db unavailable'));

    const r = await call({ host: 'node' });

    expect(r.status).toBe(503);
    expect(r.payload.reconciled).toBe(false);
  });

  it('treats a reconcile that achieved nothing as retryable, not as success', async () => {
    // GatewayService absorbs an unreachable admin surface into a null
    // snapshot and resolves normally, so "did not throw" is not the same as
    // "worked" — the outcome is what tells them apart.
    mockReconcileHost.mockResolvedValue({
      connected: 0,
      failed: 0,
      ok: false,
      reason: 'admin snapshot unavailable',
    });

    const r = await call({ host: 'node' });

    expect(r.status).toBe(503);
    expect(r.payload.reconciled).toBe(false);
  });

  describe('with redis', () => {
    beforeEach(() => {
      mockRedis.client = {
        eval: vi.fn().mockResolvedValue(1),
        set: vi.fn().mockResolvedValue('OK'),
        ttl: vi.fn().mockResolvedValue(-2),
      };
    });

    it('asks a restart inside the cooldown to come back, rather than dropping it', async () => {
      // The previous rebuild filled a registry that died with the process it
      // was built for — this restart still needs its own.
      mockRedis.client!.ttl.mockResolvedValue(30);

      const r = await call({ host: 'node' });

      expect(r.status).toBe(429);
      expect(r.headers['Retry-After']).toBe('30');
      expect(mockReconcileHost).not.toHaveBeenCalled();
    });

    it('starts no cooldown when the rebuild achieved nothing', async () => {
      // Not a thrown error — the shape a swallowed service failure actually
      // takes. A cooldown here would turn one bad round into a window where
      // the gateway is refused its retry.
      mockReconcileHost.mockResolvedValue({
        connected: 0,
        failed: 2,
        ok: false,
        reason: '2 connection(s) failed',
      });

      await call({ host: 'node' });

      const cooldownWrites = mockRedis.client!.set.mock.calls.filter(([key]) =>
        String(key).includes('cooldown'),
      );
      expect(cooldownWrites).toHaveLength(0);
    });

    it('releases the lock whether the rebuild succeeded or not', async () => {
      await call({ host: 'node' });
      expect(mockRedis.client!.eval).toHaveBeenCalledTimes(1);

      mockReconcileHost.mockRejectedValue(new Error('boom'));
      await call({ host: 'node' });
      expect(mockRedis.client!.eval).toHaveBeenCalledTimes(2);
    });

    it('defers when a cooldown appears between the first check and the lock', async () => {
      // Another request finished rebuilding in that gap and wrote the
      // cooldown. Without the re-read this one would rebuild immediately and
      // walk past the crash-loop cap.
      mockRedis.client!.ttl.mockResolvedValueOnce(-2).mockResolvedValueOnce(42);

      const r = await call({ host: 'node' });

      expect(r.status).toBe(429);
      expect(r.headers['Retry-After']).toBe('42');
      expect(mockReconcileHost).not.toHaveBeenCalled();
      // And it hands the lock back rather than sitting on it.
      expect(mockRedis.client!.eval).toHaveBeenCalled();
    });

    it('renews its own lease while the rebuild is still running', async () => {
      // A rebuild slower than the lease would otherwise have the lock expire
      // underneath it, letting a waiting caller start a second one alongside.
      vi.useFakeTimers();
      let finish: () => void = () => {};
      mockReconcileHost.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ connected: 1, failed: 0, ok: true });
          }),
      );

      const pending = call({ host: 'node' });
      await vi.advanceTimersByTimeAsync(25_000);

      const renewals = mockRedis.client!.eval.mock.calls.filter(([script]) =>
        String(script).includes('expire'),
      );
      expect(renewals.length).toBeGreaterThan(0);
      // Renewal is a compare-and-set on our own token, never a blind extend.
      expect(renewals[0][3]).toBe(
        mockRedis.client!.set.mock.calls.find(([key]) => String(key).includes('lock'))?.[1],
      );

      finish();
      await pending;
      vi.useRealTimers();
    });

    it('releases only its own lock, by token', async () => {
      await call({ host: 'node' });

      const token = mockRedis.client!.set.mock.calls.find(([key]) =>
        String(key).includes('lock'),
      )?.[1];
      const [script, keyCount, , releasedToken] = mockRedis.client!.eval.mock.calls[0];

      expect(script).toContain('redis.call("get", KEYS[1]) == ARGV[1]');
      expect(keyCount).toBe(1);
      expect(releasedToken).toBe(token);
    });

    it('never releases a lock it failed to acquire', async () => {
      // A transient redis error lets the rebuild through without the lock;
      // deleting on the way out would drop whoever actually holds it.
      mockRedis.client!.ttl.mockRejectedValue(new Error('redis blip'));

      await call({ host: 'node' });

      expect(mockReconcileHost).toHaveBeenCalled();
      expect(mockRedis.client!.eval).not.toHaveBeenCalled();
    });

    it('defers while another rebuild for the same host is in flight', async () => {
      mockRedis.client!.set.mockResolvedValue(null);

      const r = await call({ host: 'node' });

      expect(r.status).toBe(429);
      expect(mockReconcileHost).not.toHaveBeenCalled();
    });
  });
});
