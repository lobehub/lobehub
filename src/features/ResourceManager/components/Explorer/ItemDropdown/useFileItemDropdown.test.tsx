import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface SendToMessengerParams {
  enabled: boolean;
  file: { fileType?: string; id: string; name?: string; size?: number };
}

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  deleteResource: vi.fn<() => Promise<void>>(async () => {}),
  refreshFileList: vi.fn(async () => undefined),
  revalidateTree: vi.fn(async () => undefined),
  useSendToMessengerMenuItem: vi.fn((_params: SendToMessengerParams) => undefined),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: mocks.confirmModal,
  toast: {
    error: vi.fn(),
    loading: vi.fn(() => ({ close: vi.fn() })),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/features/Messenger/PushResourceModal/useSendToMessengerMenuItem', () => ({
  useSendToMessengerMenuItem: mocks.useSendToMessengerMenuItem,
}));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.example.com' }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/ResourceManager/components/KnowledgeBaseListProvider', () => ({
  useKnowledgeBaseListContext: () => [],
}));
vi.mock('@/store/user', () => ({ useUserStore: () => 'user-1' }));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { userId: vi.fn() } }));
vi.mock('@/store/file', () => ({
  useFileStore: Object.assign(
    () => ({
      deleteResource: mocks.deleteResource,
      moveResource: vi.fn(),
      publishFileToWorkspace: vi.fn(),
      refreshFileList: mocks.refreshFileList,
      setFileVisibility: vi.fn(),
    }),
    { getState: () => ({ queryParams: { parentId: 'parent-id' } }) },
  ),
}));
vi.mock('@/store/library', () => ({ useKnowledgeBaseStore: () => [vi.fn(), vi.fn()] }));
vi.mock('@/store/tree', () => ({
  useTreeStore: Object.assign(() => vi.fn(), {
    getState: () => ({ revalidate: mocks.revalidateTree }),
  }),
}));

const { useFileItemDropdown } = await import('./useFileItemDropdown');

const baseParams = {
  fileType: 'markdown',
  filename: 'notes.md',
  id: 'resource-id',
  size: 10,
  url: 'https://storage.example.com/notes.md',
};

const pushedFile = () => mocks.useSendToMessengerMenuItem.mock.calls.at(-1)![0].file;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFileItemDropdown — messenger push id', () => {
  it('sends the underlying fileId, not the list id, for a file behind a derived page', () => {
    // Regression: the unified resource list keys such a row by the PAGE id, but
    // the server resolves the attachment by `files.id` — pushing sent an id the
    // file table has never seen and the call failed with NOT_FOUND.
    renderHook(() => useFileItemDropdown({ ...baseParams, fileId: 'file-id' } as any));

    expect(pushedFile().id).toBe('file-id');
  });

  it('falls back to the row id when there is no separate fileId', () => {
    renderHook(() => useFileItemDropdown({ ...baseParams, fileId: undefined } as any));

    expect(pushedFile().id).toBe('resource-id');
  });

  it('falls back to the row id when fileId is null', () => {
    // `toTreeItem` carries `fileId` straight from the API, which yields null
    // (not undefined) for rows with no backing file.
    renderHook(() => useFileItemDropdown({ ...baseParams, fileId: null } as any));

    expect(pushedFile().id).toBe('resource-id');
  });
});

describe('useFileItemDropdown — workspace resource permissions', () => {
  it("lets an editor rename and delete another member's folder", () => {
    const { result } = renderHook(() =>
      useFileItemDropdown({
        ...baseParams,
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        userId: 'another-member',
      } as any),
    );

    const items = result.current.menuItems();
    const renameItem = items.find((item) => item?.key === 'rename');
    const deleteItem = items.find((item) => item?.key === 'delete');

    expect(renameItem).toBeTruthy();
    expect(renameItem && 'disabled' in renameItem ? renameItem.disabled : undefined).not.toBe(true);
    expect(deleteItem).toBeTruthy();
    expect(deleteItem && 'disabled' in deleteItem ? deleteItem.disabled : undefined).not.toBe(true);
  });

  it('closes the confirmation without waiting for the delete request', async () => {
    let resolveDelete!: () => void;
    const pendingDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    mocks.deleteResource.mockReturnValueOnce(pendingDelete);

    const { result } = renderHook(() => useFileItemDropdown(baseParams as any));
    const deleteItem = result.current.menuItems().find((item) => item?.key === 'delete') as any;
    await deleteItem.onClick({ domEvent: { stopPropagation: vi.fn() } });

    const modalOptions = mocks.confirmModal.mock.calls.at(-1)![0];
    expect(modalOptions.onOk()).toBeUndefined();
    expect(mocks.deleteResource).toHaveBeenCalledWith('resource-id');

    resolveDelete();
    await pendingDelete;
    await waitFor(() => expect(mocks.refreshFileList).toHaveBeenCalled());
  });
});
