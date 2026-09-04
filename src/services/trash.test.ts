import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trashService } from './trash';

const { mockPurge, mockRestore } = vi.hoisted(() => ({
  mockPurge: vi.fn(),
  mockRestore: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    trash: {
      purge: { mutate: mockPurge },
      restore: { mutate: mockRestore },
    },
  },
}));

describe('TrashService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splits restore requests and combines their outcomes', async () => {
    let releaseFirst!: () => void;
    mockRestore
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve({ failed: [], restored: [{ id: 'trash-0' }] });
          }),
      )
      .mockResolvedValueOnce({
        failed: [{ code: 'parentTrashed', id: 'trash-200' }],
        restored: [],
      })
      .mockResolvedValueOnce({ failed: [], restored: [{ id: 'trash-400' }] });
    const ids = Array.from({ length: 401 }, (_, index) => `trash-${index}`);

    const restorePromise = trashService.restore(ids);
    expect(mockRestore).toHaveBeenCalledTimes(1);
    releaseFirst();

    await expect(restorePromise).resolves.toEqual({
      failed: [{ code: 'parentTrashed', id: 'trash-200' }],
      restored: [{ id: 'trash-0' }, { id: 'trash-400' }],
    });
    expect(mockRestore.mock.calls.map(([input]) => input.ids.length)).toEqual([200, 200, 1]);
    expect(mockRestore.mock.calls.flatMap(([input]) => input.ids)).toEqual(ids);
  });

  it('splits purge requests and combines their outcomes', async () => {
    mockPurge
      .mockResolvedValueOnce({ failed: [], purged: 200, purgedIds: ['trash-0'] })
      .mockResolvedValueOnce({
        failed: [{ code: 'notFound', id: 'trash-200' }],
        purged: 199,
        purgedIds: ['trash-201'],
      })
      .mockResolvedValueOnce({ failed: [], purged: 1, purgedIds: ['trash-400'] });
    const ids = Array.from({ length: 401 }, (_, index) => `trash-${index}`);

    await expect(trashService.purge(ids)).resolves.toEqual({
      failed: [{ code: 'notFound', id: 'trash-200' }],
      purged: 400,
      purgedIds: ['trash-0', 'trash-201', 'trash-400'],
    });
    expect(mockPurge.mock.calls.map(([input]) => input.ids.length)).toEqual([200, 200, 1]);
    expect(mockPurge.mock.calls.flatMap(([input]) => input.ids)).toEqual(ids);
  });
});
