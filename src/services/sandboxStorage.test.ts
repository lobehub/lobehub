import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listInstances: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    sandboxStorage: { listInstances: { query: mocks.listInstances } },
  },
}));

const { sandboxStorageService } = await import('./sandboxStorage');

describe('sandboxStorageService.listInstances', () => {
  beforeEach(() => {
    mocks.listInstances.mockReset();
  });

  it("marks each environment's default instance with the shared rule", async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    mocks.listInstances.mockResolvedValue({
      instances: [
        { createdAt: new Date('2026-02-01T00:00:00Z'), environmentId: 'env', id: 'later' },
        { createdAt, environmentId: 'env', id: 'b-tied' },
        { createdAt, environmentId: 'env', id: 'a-tied' },
      ],
      occupancyUnavailable: false,
    });

    const result = await sandboxStorageService.listInstances({ withSizes: false });

    expect(mocks.listInstances).toHaveBeenCalledWith({ withSizes: false });
    expect(result.occupancyUnavailable).toBe(false);
    expect(result.instances.map((instance) => [instance.id, instance.isDefault])).toEqual([
      ['later', false],
      ['b-tied', false],
      ['a-tied', true],
    ]);
  });
});
