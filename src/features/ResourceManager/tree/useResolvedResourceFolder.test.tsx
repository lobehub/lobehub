import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';

import { useResolvedResourceFolder } from './useResolvedResourceFolder';

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('useResolvedResourceFolder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns root state without calling the API when no slug is provided', () => {
    const getFolderBreadcrumbSpy = vi.spyOn(fileService, 'getFolderBreadcrumb');

    const { result } = renderHook(() => useResolvedResourceFolder(null));

    expect(result.current).toEqual({
      ancestorIds: [],
      folderId: null,
      isLoading: false,
    });
    expect(getFolderBreadcrumbSpy).not.toHaveBeenCalled();
  });

  it('resolves breadcrumb ids into ancestor ids and the selected folder id', async () => {
    vi.spyOn(fileService, 'getFolderBreadcrumb').mockResolvedValue([
      { id: 'root-folder', name: 'Root', slug: 'root-folder' },
      { id: 'child-folder', name: 'Child', slug: 'child-folder' },
    ]);

    const { result } = renderHook(() => useResolvedResourceFolder('child-folder'));

    await waitFor(() => {
      expect(result.current).toEqual({
        ancestorIds: ['root-folder', 'child-folder'],
        folderId: 'child-folder',
        isLoading: false,
      });
    });

    expect(fileService.getFolderBreadcrumb).toHaveBeenCalledWith('child-folder');
  });

  it('does not let a stale slug response overwrite the latest result', async () => {
    const staleResponse = createDeferred<{ id: string; name: string; slug: string }[]>();

    vi.spyOn(fileService, 'getFolderBreadcrumb').mockImplementation((slug) => {
      if (slug === 'stale-folder') return staleResponse.promise;

      return Promise.resolve([{ id: 'current-folder', name: 'Current', slug: 'current-folder' }]);
    });

    const { rerender, result } = renderHook(({ slug }) => useResolvedResourceFolder(slug), {
      initialProps: { slug: 'stale-folder' },
    });

    await waitFor(() => {
      expect(fileService.getFolderBreadcrumb).toHaveBeenCalledWith('stale-folder');
    });

    rerender({ slug: 'current-folder' });

    await waitFor(() => {
      expect(result.current).toEqual({
        ancestorIds: ['current-folder'],
        folderId: 'current-folder',
        isLoading: false,
      });
    });

    await act(async () => {
      staleResponse.resolve([{ id: 'stale-folder', name: 'Stale', slug: 'stale-folder' }]);
      await staleResponse.promise;
    });

    expect(result.current).toEqual({
      ancestorIds: ['current-folder'],
      folderId: 'current-folder',
      isLoading: false,
    });
  });
});
