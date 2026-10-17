import { expect, it, vi } from 'vitest';

const readiness = async (probe: () => Promise<boolean>) => ({
  status: (await probe()) ? 200 : 503,
});

it('reports unavailable when its dependency is unhealthy', async () => {
  expect(await readiness(vi.fn().mockResolvedValue(false))).toEqual({ status: 503 });
});
