/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { useWorkspaceWorksInfinite } from './hooks';

const mocks = vi.hoisted(() => ({
  deleteDocument: vi.fn(),
  deleteDocuments: vi.fn(),
  globalMutate: vi.fn(),
  infiniteMutate: vi.fn(),
  setSize: vi.fn(),
}));

vi.mock('swr/infinite', () => ({
  default: vi.fn(() => ({
    data: [{ items: [], nextCursor: null }],
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: mocks.infiniteMutate,
    setSize: mocks.setSize,
    size: 1,
  })),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: { listVisibility: string }) => unknown) =>
    selector({ listVisibility: 'private' }),
}));

vi.mock('@/libs/swr', () => ({
  mutate: (...args: unknown[]) => mocks.globalMutate(...args),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    document: {
      deleteDocument: { mutate: (...args: unknown[]) => mocks.deleteDocument(...args) },
      deleteDocuments: { mutate: (...args: unknown[]) => mocks.deleteDocuments(...args) },
    },
    work: {},
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteDocument.mockResolvedValue(undefined);
  mocks.deleteDocuments.mockResolvedValue(undefined);
  mocks.globalMutate.mockResolvedValue([]);
  mocks.infiniteMutate.mockResolvedValue([]);
});

describe('useWorkspaceWorksInfinite', () => {
  it.each([
    ['one document', () => documentService.deleteDocument('doc-1')],
    ['multiple documents', () => documentService.deleteDocuments(['doc-1', 'doc-2'])],
  ])('refreshes the mounted gallery after deleting %s', async (_label, removeDocuments) => {
    const { unmount } = renderHook(() => useWorkspaceWorksInfinite('all'));

    await act(removeDocuments);

    expect(mocks.infiniteMutate).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('stops refreshing a gallery after it unmounts', async () => {
    const { unmount } = renderHook(() => useWorkspaceWorksInfinite('all'));
    unmount();

    await documentService.deleteDocument('doc-1');

    expect(mocks.infiniteMutate).not.toHaveBeenCalled();
  });

  it('keeps a completed document deletion successful when gallery refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useWorkspaceWorksInfinite('all'));
    mocks.infiniteMutate.mockRejectedValueOnce(new Error('refresh failed'));

    await expect(documentService.deleteDocument('doc-1')).resolves.toBeUndefined();

    expect(mocks.deleteDocument).toHaveBeenCalledWith({ id: 'doc-1' });
    expect(consoleError).toHaveBeenCalledWith(
      '[DocumentService] Failed to refresh Works after document deletion:',
      expect.any(Error),
    );
    unmount();
    consoleError.mockRestore();
  });
});
