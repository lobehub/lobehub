import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { Component } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface SendToMessengerParams {
  enabled: boolean;
  file: { fileType?: string; id: string; name?: string; size?: number };
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  activeWorkspaceSlug: null as string | null,
  copyToClipboard: vi.fn(async (_text: string) => undefined),
  confirmModal: vi.fn(),
  deleteResource: vi.fn<() => Promise<void>>(async () => {}),
  dropTreeNodes: vi.fn(async () => undefined),
  publishFileToWorkspace: vi.fn(async (_id: string) => undefined),
  setFileVisibility: vi.fn(async (_id: string, _visibility: string) => undefined),
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
      publishFileToWorkspace: mocks.publishFileToWorkspace,
      refreshFileList: mocks.refreshFileList,
      setFileVisibility: mocks.setFileVisibility,
    }),
    { getState: () => ({ queryParams: { parentId: 'parent-id' } }) },
  ),
}));
vi.mock('@/store/library', () => ({ useKnowledgeBaseStore: () => [vi.fn(), vi.fn()] }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('@/store/tree', () => ({
  useTreeStore: Object.assign(() => vi.fn(), {
    getState: () => ({ dropNodes: mocks.dropTreeNodes, revalidate: mocks.revalidateTree }),
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
  mocks.activeWorkspaceId = null;
  mocks.activeWorkspaceSlug = null;
});

/** @example Sharing a workspace page copies a link other members can open. */
describe('useFileItemDropdown — copy link', () => {
  // ROOT CAUSE:
  //
  // Workspace routes live under `/:workspaceSlug`, but the copied page link was
  // built as `${origin}/resource?file=…` regardless of scope, so recipients
  // opened it in the personal scope where the workspace page does not resolve.
  const copyLink = async (params: Record<string, unknown> = {}) => {
    const { result } = renderHook(() =>
      useFileItemDropdown({ ...baseParams, fileType: 'custom/document', ...params } as any),
    );
    const item = result.current.menuItems().find((entry) => entry?.key === 'copyUrl') as any;
    await item.onClick({ domEvent: { stopPropagation: vi.fn() } });
    return mocks.copyToClipboard.mock.calls.at(-1)![0];
  };

  it('prefixes the page link with the active workspace slug', async () => {
    mocks.activeWorkspaceId = 'ws-1';
    mocks.activeWorkspaceSlug = 'acme';
    await expect(copyLink({ id: 'docs_abc' })).resolves.toBe(
      'https://app.example.com/acme/resource?file=docs_abc',
    );
  });

  it('keeps the library page link inside the workspace', async () => {
    mocks.activeWorkspaceId = 'ws-1';
    mocks.activeWorkspaceSlug = 'acme';
    await expect(copyLink({ id: 'docs_abc', libraryId: 'kb_1' })).resolves.toBe(
      'https://app.example.com/acme/resource/library/kb_1?file=docs_abc',
    );
  });

  it('leaves the personal-scope page link unprefixed', async () => {
    await expect(copyLink({ id: 'docs_abc' })).resolves.toBe(
      'https://app.example.com/resource?file=docs_abc',
    );
  });

  it('copies the storage URL for a regular file regardless of workspace', async () => {
    mocks.activeWorkspaceSlug = 'acme';
    await expect(copyLink({ fileType: 'markdown' })).resolves.toBe(baseParams.url);
  });
});

describe('useFileItemDropdown — visibility toggles', () => {
  const ownFile = (visibility: 'private' | 'public') =>
    renderHook(() => useFileItemDropdown({ ...baseParams, userId: 'user-1', visibility } as any));
  const keys = (result: { current: { menuItems: () => any[] } }) =>
    result.current.menuItems().map((item) => item?.key);

  it('hides "Make private" and "Publish to workspace" in personal mode', () => {
    // Regression: `files.visibility` defaults to 'public' even when
    // `workspace_id IS NULL`, so every personal file offered "Make private".
    expect(keys(ownFile('public').result)).not.toContain('makePrivate');
    expect(keys(ownFile('private').result)).not.toContain('publishToWorkspace');
  });

  it('offers the matching toggle for the creator inside a workspace', () => {
    mocks.activeWorkspaceId = 'ws-1';
    expect(keys(ownFile('public').result)).toContain('makePrivate');
    expect(keys(ownFile('private').result)).toContain('publishToWorkspace');
  });

  it("never offers the toggles on another member's workspace file", () => {
    mocks.activeWorkspaceId = 'ws-1';
    const { result } = renderHook(() =>
      useFileItemDropdown({ ...baseParams, userId: 'another-member', visibility: 'public' } as any),
    );
    expect(keys(result)).not.toContain('makePrivate');
  });
});

/** @example Publishing or unpublishing an extracted spreadsheet changes its backing file. */
describe('useFileItemDropdown — backing file visibility', () => {
  // ROOT CAUSE:
  //
  // The resource list uses the parsed document ID after extracting an Office file.
  // Visibility actions previously passed that document ID to file-only endpoints,
  // which returned NOT_FOUND. Both actions must use the underlying fileId.
  /** @example A docs_* row publishes its file_* attachment after confirmation. */
  it('publishes the underlying file for a parsed spreadsheet', async () => {
    mocks.activeWorkspaceId = 'ws-1';
    const { result } = renderHook(() =>
      useFileItemDropdown({
        ...baseParams,
        fileId: 'file-spreadsheet',
        filename: 'trip.xlsx',
        id: 'docs-spreadsheet',
        sourceType: 'file',
        userId: 'user-1',
        visibility: 'private',
      }),
    );
    const item = result.current.menuItems().find((item) => item?.key === 'publishToWorkspace');
    if (!item || !('onClick' in item) || !item.onClick) throw new Error('Missing publish action');
    const menu = render(
      <button
        onClick={(domEvent) =>
          item.onClick?.({
            domEvent,
            item: new Component({}),
            key: String(item.key),
            keyPath: [String(item.key)],
          })
        }
      >
        Change visibility
      </button>,
    );
    fireEvent.click(menu.getByRole('button', { name: 'Change visibility' }));
    await mocks.confirmModal.mock.calls.at(-1)![0].onOk();

    /** @example The file endpoint receives file-spreadsheet, never docs-spreadsheet. */
    expect(mocks.publishFileToWorkspace).toHaveBeenCalledWith('file-spreadsheet');
  });

  /** @example A published docs_* row makes its file_* attachment private. */
  it('makes the underlying file private for a parsed spreadsheet', async () => {
    mocks.activeWorkspaceId = 'ws-1';
    const { result } = renderHook(() =>
      useFileItemDropdown({
        ...baseParams,
        fileId: 'file-spreadsheet',
        filename: 'trip.xlsx',
        id: 'docs-spreadsheet',
        sourceType: 'file',
        userId: 'user-1',
        visibility: 'public',
      }),
    );
    const item = result.current.menuItems().find((item) => item?.key === 'makePrivate');
    if (!item || !('onClick' in item) || !item.onClick) throw new Error('Missing private action');
    const menu = render(
      <button
        onClick={(domEvent) =>
          item.onClick?.({
            domEvent,
            item: new Component({}),
            key: String(item.key),
            keyPath: [String(item.key)],
          })
        }
      >
        Change visibility
      </button>,
    );
    fireEvent.click(menu.getByRole('button', { name: 'Change visibility' }));
    await mocks.confirmModal.mock.calls.at(-1)![0].onOk();

    /** @example The file endpoint updates file-spreadsheet to private. */
    expect(mocks.setFileVisibility).toHaveBeenCalledWith('file-spreadsheet', 'private');
  });
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

  it("refreshes the row's own folder, not the folder the explorer is listing", async () => {
    // Regression: the sidebar navigates into a folder on click, so
    // deleting it from its own context menu refreshed the deleted folder while
    // the parent list the sidebar renders kept the row until a page reload.
    const { result } = renderHook(() =>
      useFileItemDropdown({
        ...baseParams,
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        parentId: 'tree-parent-id',
      } as any),
    );
    const deleteItem = result.current.menuItems().find((item) => item?.key === 'delete') as any;
    await deleteItem.onClick({ domEvent: { stopPropagation: vi.fn() } });

    mocks.confirmModal.mock.calls.at(-1)![0].onOk();

    await waitFor(() =>
      expect(mocks.dropTreeNodes).toHaveBeenCalledWith(['resource-id'], 'tree-parent-id'),
    );
  });

  it("falls back to the explorer's folder for a row the tree does not own", async () => {
    const { result } = renderHook(() => useFileItemDropdown(baseParams as any));
    const deleteItem = result.current.menuItems().find((item) => item?.key === 'delete') as any;
    await deleteItem.onClick({ domEvent: { stopPropagation: vi.fn() } });

    mocks.confirmModal.mock.calls.at(-1)![0].onOk();

    await waitFor(() =>
      expect(mocks.dropTreeNodes).toHaveBeenCalledWith(['resource-id'], 'parent-id'),
    );
  });
});
