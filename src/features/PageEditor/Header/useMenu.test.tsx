/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMenu } from './useMenu';

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));

const resourcePermissionMock = vi.hoisted(() => ({
  canManage: false,
  workspaceId: undefined as string | undefined,
}));
const wsNavigateMock = vi.hoisted(() => vi.fn());
const favoriteMenuItemMock = vi.hoisted(() => vi.fn(() => null));
const pageEditorState = vi.hoisted(() => ({ title: undefined as string | undefined }));
const documentStoreMock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
const menuActionMocks = vi.hoisted(() => ({
  handleCopyLink: vi.fn(),
  handleDelete: vi.fn(),
  setRightPanelMode: vi.fn(),
  togglePageAgentPanel: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en-US',
      resolvedLanguage: 'en-US',
    },
    t: (key: string) => key,
  }),
}));

vi.mock('@lobechat/const', () => ({
  CUSTOM_DOCUMENT_FILE_TYPE: 'custom/document',
  HTML_DOCUMENT_FILE_TYPE: 'custom/html',
  isDesktop: false,
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: vi.fn(),
}));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: {
    useApp: () => ({
      message: {
        error: vi.fn(),
        success: vi.fn(),
      },
      modal: {
        confirm: vi.fn(),
      },
    }),
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => resourcePermissionMock.workspaceId,
}));

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: () => undefined,
}));

vi.mock('@/business/client/hooks/useDocumentTransferMenuItem', () => ({
  useDocumentTransferMenuItem: () => null,
}));

vi.mock('@/features/Favorites', () => ({
  FavoriteButton: () => null,
  useCurrentFavoritePath: () => '/favorite-path',
  useFavoriteMenuItem: favoriteMenuItemMock,
}));
vi.mock('@/features/VisibilityConfirmContent', () => ({
  default: () => null,
}));

vi.mock('@/features/ResourcePermission/useResourcePermission', () => ({
  useResourcePermission: (_type: string, resourceId?: string) => ({
    data: resourceId ? { canManage: resourcePermissionMock.canManage } : undefined,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
    setAccessLevel: vi.fn(),
    updating: false,
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => wsNavigateMock,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(documentStoreMock.state),
}));

vi.mock('@/store/page', () => ({
  pageSelectors: {
    getDocumentById: (_id: string) => (_s: unknown) => undefined,
  },
  pageActions: {
    publishPageToWorkspace: vi.fn(),
    setPageVisibility: vi.fn(),
  },
  usePageStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: () => undefined,
  },
}));

vi.mock('@/store/document/slices/editor', () => ({
  editorSelectors: {
    lastUpdatedTime: () => () => null,
  },
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ duplicateDocument: vi.fn() }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      togglePageAgentPanel: menuActionMocks.togglePageAgentPanel,
      toggleWideScreen: vi.fn(),
      wideScreen: false,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    wideScreen: (state: { wideScreen: boolean }) => state.wideScreen,
  },
}));

vi.mock('../store', () => ({
  usePageEditorStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      documentId: 'doc-1',
      setRightPanelMode: menuActionMocks.setRightPanelMode,
      title: pageEditorState.title,
    }),
  useStoreApi: () => ({
    getState: () => ({
      editor: {
        getDocument: () => '# Hello',
      },
      handleCopyLink: menuActionMocks.handleCopyLink,
      handleDelete: menuActionMocks.handleDelete,
      title: 'Hello',
    }),
  }),
}));

const getMenuItem = (items: ReturnType<typeof useMenu>['menuItems'], key: string) =>
  items.find((item) => item && 'key' in item && item.key === key);

describe('PageEditor header menu', () => {
  beforeEach(() => {
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
    resourcePermissionMock.canManage = false;
    resourcePermissionMock.workspaceId = undefined;
    documentStoreMock.state = { documentDetailMap: {} };
    pageEditorState.title = undefined;
    vi.clearAllMocks();
  });

  it('lets a loaded untitled page be favorited, but waits while the title is loading', () => {
    renderHook(() => useMenu());
    expect(favoriteMenuItemMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotReady: false }),
    );

    pageEditorState.title = '';
    renderHook(() => useMenu());
    expect(favoriteMenuItemMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotReady: true, title: 'pageEditor.titlePlaceholder' }),
    );
  });

  it('favorites the page under its canonical link, not the location underneath a modal', () => {
    renderHook(() => useMenu());

    expect(favoriteMenuItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/page/doc-1', targetId: 'doc-1', type: 'page' }),
    );
  });

  it('exports an HTML page as HTML and offers no editor history', () => {
    const exportChildren = (items: ReturnType<typeof useMenu>['menuItems']) =>
      (getMenuItem(items, 'export') as { children: { key: string }[] }).children.map(
        (child) => child.key,
      );

    const { result: page } = renderHook(() => useMenu());
    expect(exportChildren(page.current.menuItems)).toEqual(['export-markdown']);
    expect(getMenuItem(page.current.menuItems, 'version-history')).toBeDefined();

    documentStoreMock.state = {
      documentDetailMap: { 'doc-1': { document: { fileType: 'custom/html', id: 'doc-1' } } },
    };
    const { result: htmlPage } = renderHook(() => useMenu());

    expect(exportChildren(htmlPage.current.menuItems)).toEqual(['export-html']);
    expect(getMenuItem(htmlPage.current.menuItems, 'version-history')).toBeUndefined();
    expect(getMenuItem(htmlPage.current.menuItems, 'duplicate')).toBeDefined();
  });

  it('places the member-permission page entry in the overflow menu for managers', () => {
    resourcePermissionMock.workspaceId = 'ws-1';
    resourcePermissionMock.canManage = true;

    const { result } = renderHook(() => useMenu());

    const item = getMenuItem(result.current.menuItems, 'member-permissions');
    expect(item).toMatchObject({ label: 'permission.page.entry' });
    (item as { onClick: () => void }).onClick();
    expect(wsNavigateMock).toHaveBeenCalledWith('/page/doc-1/permission');
  });

  it('hides the member-permission entry for non-managers', () => {
    resourcePermissionMock.workspaceId = 'ws-1';
    resourcePermissionMock.canManage = false;

    const { result } = renderHook(() => useMenu());

    expect(getMenuItem(result.current.menuItems, 'member-permissions')).toBeUndefined();
  });

  it('disables mutating page actions for workspace viewers', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() => useMenu());
    const items = result.current.menuItems;

    expect(getMenuItem(items, 'duplicate')).toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'delete')).toMatchObject({ disabled: true });

    expect(getMenuItem(items, 'full-width')).not.toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'copy-link')).not.toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'version-history')).not.toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'export')).not.toMatchObject({ disabled: true });
  });

  it('uses surface-specific actions when provided', async () => {
    const onCopyLink = vi.fn();
    const onDeleted = vi.fn();
    const onOpenHistory = vi.fn();
    const { result } = renderHook(() => useMenu({ onCopyLink, onDeleted, onOpenHistory }));

    (getMenuItem(result.current.menuItems, 'copy-link') as { onClick: () => void }).onClick();
    (getMenuItem(result.current.menuItems, 'version-history') as { onClick: () => void }).onClick();
    await (
      getMenuItem(result.current.menuItems, 'delete') as { onClick: () => Promise<void> }
    ).onClick();

    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(menuActionMocks.handleCopyLink).not.toHaveBeenCalled();
    expect(menuActionMocks.setRightPanelMode).toHaveBeenCalledWith('history');
    expect(onOpenHistory).toHaveBeenCalledOnce();
    expect(menuActionMocks.togglePageAgentPanel).not.toHaveBeenCalled();
    expect(menuActionMocks.handleDelete).toHaveBeenCalledWith(expect.any(Function), onDeleted);
  });
});
