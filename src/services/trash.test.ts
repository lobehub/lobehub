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

  it('forwards the full restore selection for one server-side preflight', async () => {
    mockRestore.mockRejectedValue(new Error('selection exceeds the server limit'));
    const ids = Array.from({ length: 401 }, (_, index) => `trash-${index}`);

    await expect(trashService.restore(ids)).rejects.toThrow('selection exceeds the server limit');
    expect(mockRestore).toHaveBeenCalledOnce();
    expect(mockRestore).toHaveBeenCalledWith({ ids });
  });

  it('forwards the full purge selection before any irreversible mutation', async () => {
    mockPurge.mockRejectedValue(new Error('selection exceeds the server limit'));
    const ids = Array.from({ length: 401 }, (_, index) => `trash-${index}`);

    await expect(trashService.purge(ids)).rejects.toThrow('selection exceeds the server limit');
    expect(mockPurge).toHaveBeenCalledOnce();
    expect(mockPurge).toHaveBeenCalledWith({ ids });
  });
});
