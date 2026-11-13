import type * as QuotaSampler from '@lobechat/heterogeneous-agents/quota-sampler';
import { describe, expect, it, vi } from 'vitest';

import { getAntigravityQuota } from './antigravityQuota';

const fetchQuota = vi.hoisted(() => vi.fn());
vi.mock('@lobechat/heterogeneous-agents/quota-sampler', async (importOriginal) => ({
  ...(await importOriginal<typeof QuotaSampler>()),
  fetchAntigravityQuota: fetchQuota,
}));

describe('Antigravity host quota cache', () => {
  it('coalesces callers while isolating command/profile and honoring force refresh', async () => {
    const snapshot = {
      error: null,
      groups: [],
      provider: 'antigravity',
      status: 'ok',
      updatedAt: Date.now(),
    };
    fetchQuota.mockResolvedValue(snapshot);
    const params = { command: '/custom/agy', env: { HOME: '/profile/a' } };
    const [first, second] = await Promise.all([
      getAntigravityQuota(params),
      getAntigravityQuota(params),
    ]);
    expect(first).toBe(second);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    await getAntigravityQuota({ ...params, force: true });
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    await getAntigravityQuota({ ...params, env: { HOME: '/profile/b' } });
    await getAntigravityQuota({ ...params, command: '/other/agy' });
    expect(fetchQuota).toHaveBeenCalledTimes(4);
  });
});
