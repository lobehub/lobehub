/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDropdownMenu } from './useDropdownMenu';

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));

const CURRENT_USER_ID = vi.hoisted(() => 'user-1');

const storeMock = vi.hoisted(() => ({
  activeWorkspaceId: undefined as string | undefined,
  document: undefined as
    { id: string; userId?: string; visibility?: 'private' | 'public' | null } | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('antd', () => ({
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

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('@/features/Electron/titlebar/RecentlyViewed/plugins', () => ({
  pluginRegistry: {
    parseUrl: vi.fn(),
  },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ addTab: vi.fn() }),
}));

vi.mock('@/store/page', () => ({
  pageSelectors: {
    getDocumentById: (_id: string) => (_s: unknown) => storeMock.document,
    getFilteredDocuments: (_s: unknown) => (storeMock.document ? [storeMock.document] : []),
  },
  usePageStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        duplicatePage: vi.fn(),
        publishPageToWorkspace: vi.fn(),
        removePage: vi.fn(),
      }),
    {
      getState: () => ({
        duplicatePage: vi.fn(),
        publishPageToWorkspace: vi.fn(),
        removePage: vi.fn(),
      }),
    },
  ),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { id: CURRENT_USER_ID } }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: { user?: { id?: string } }) => state.user?.id,
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => storeMock.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => undefined,
}));

vi.mock('@/business/client/hooks/useDocumentTransferMenuItem', () => ({
  useDocumentTransferMenuItem: () => [],
}));

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useDropdownMenu>>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('Page list item dropdown menu', () => {
  beforeEach(() => {
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
    storeMock.activeWorkspaceId = undefined;
    storeMock.document = undefined;
  });

  it('disables page management actions for workspace viewers', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() =>
      useDropdownMenu({ pageId: 'page-1', toggleEditing: vi.fn() }),
    );
    const items = result.current();

    expect(getMenuItem(items, 'rename')).toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'duplicate')).toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'delete')).toMatchObject({ disabled: true });
  });

  it('exposes "publish to workspace" for private pages in workspace mode', () => {
    storeMock.activeWorkspaceId = 'ws-1';
    storeMock.document = { id: 'page-1', userId: CURRENT_USER_ID, visibility: 'private' };

    const { result } = renderHook(() =>
      useDropdownMenu({ pageId: 'page-1', toggleEditing: vi.fn() }),
    );
    const items = result.current();

    expect(getMenuItem(items, 'publishToWorkspace')).toBeTruthy();
  });

  it('hides "publish to workspace" for workspace-visible pages', () => {
    storeMock.activeWorkspaceId = 'ws-1';
    storeMock.document = { id: 'page-1', userId: CURRENT_USER_ID, visibility: 'public' };

    const { result } = renderHook(() =>
      useDropdownMenu({ pageId: 'page-1', toggleEditing: vi.fn() }),
    );
    const items = result.current();

    expect(getMenuItem(items, 'publishToWorkspace')).toBeUndefined();
  });

  it('hides "publish to workspace" in personal mode even for private pages', () => {
    storeMock.activeWorkspaceId = undefined;
    storeMock.document = { id: 'page-1', visibility: 'private' };

    const { result } = renderHook(() =>
      useDropdownMenu({ pageId: 'page-1', toggleEditing: vi.fn() }),
    );
    const items = result.current();

    expect(getMenuItem(items, 'publishToWorkspace')).toBeUndefined();
  });

  it('hides "publish to workspace" for viewers without edit permission', () => {
    storeMock.activeWorkspaceId = 'ws-1';
    storeMock.document = { id: 'page-1', userId: CURRENT_USER_ID, visibility: 'private' };
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() =>
      useDropdownMenu({ pageId: 'page-1', toggleEditing: vi.fn() }),
    );
    const items = result.current();

    expect(getMenuItem(items, 'publishToWorkspace')).toBeUndefined();
  });
});
