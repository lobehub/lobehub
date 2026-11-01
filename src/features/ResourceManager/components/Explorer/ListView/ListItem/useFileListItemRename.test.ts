import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  patchSearchHit: vi.fn(),
  revalidateTree: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: { getState: () => ({ patchSearchHit: mocks.patchSearchHit }) },
}));
vi.mock('@/store/tree', () => ({
  useTreeStore: { getState: () => ({ revalidate: mocks.revalidateTree }) },
}));
vi.mock('@/store/file', () => ({
  useFileStore: { getState: () => ({ queryParams: { parentId: 'parent-id' } }) },
}));

const { useFileListItemRename } = await import('./useFileListItemRename');

const renderRename = (
  updateResource: (id: string, payload: { name: string }) => Promise<unknown>,
) =>
  renderHook(() =>
    useFileListItemRename({
      id: 'file-1',
      isFolder: false,
      name: 'old name',
      refreshFileList: vi.fn(async () => undefined),
      setPendingRenameItemId: vi.fn(),
      updateResource,
    }),
  );

const rename = async (result: ReturnType<typeof renderRename>['result'], value: string) => {
  act(() => result.current.handleRenameStart());
  act(() => result.current.setRenamingValue(value));
  await act(async () => {
    await result.current.handleRenameConfirm();
  });
};

describe('useFileListItemRename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries the new name into the cached search results', async () => {
    // Regression: renaming a search hit updated the file store and the tree
    // only, while the search overlay kept rendering its own persisted replica
    // with the old name (and old query membership).
    const updateResource = vi.fn(async () => undefined);
    const { result } = renderRename(updateResource);

    await rename(result, '  new name  ');

    expect(updateResource).toHaveBeenCalledWith('file-1', { name: 'new name' });
    expect(mocks.patchSearchHit).toHaveBeenCalledWith('file-1', { name: 'new name' });
  });

  it('leaves the cached search results alone when the rename fails', async () => {
    const { result } = renderRename(
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );

    await rename(result, 'new name');

    expect(mocks.patchSearchHit).not.toHaveBeenCalled();
  });
});
