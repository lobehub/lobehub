/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMenu } from './useMenu';

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));

const headerMock = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-1' as string | undefined,
  authorName: undefined as string | undefined,
  currentUserId: 'user-1',
  document: {
    id: 'doc-1',
    updatedAt: undefined as string | undefined,
    userId: 'user-1',
    visibility: 'private' as 'private' | 'public',
  },
  transferMenuItems: vi.fn(() => [{ key: 'transfer-document', label: 'Move' }]),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en-US',
      resolvedLanguage: 'en-US',
    },
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'pageEditor.editedAtBy') {
        return `Last edited on ${options?.time} by ${options?.name}`;
      }

      return key;
    },
  }),
}));

vi.mock('@lobechat/const', () => ({
  CUSTOM_DOCUMENT_FILE_TYPE: 'custom/document',
  isDesktop: false,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
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

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({}),
  cssVar: {
    colorTextTertiary: 'colorTextTertiary',
  },
  cx: (...args: unknown[]) => args.filter(Boolean).join(' '),
  keyframes: () => '',
  useResponsive: () => ({ lg: true }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => headerMock.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: () => ({ fullName: headerMock.authorName }),
}));

vi.mock('@/business/client/hooks/useDocumentTransferMenuItem', () => ({
  useDocumentTransferMenuItem: headerMock.transferMenuItems,
}));

vi.mock('@/features/VisibilityConfirmContent', () => ({
  default: () => null,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock('@/store/page', () => ({
  pageSelectors: {
    getDocumentById: (_id: string) => (_s: unknown) => headerMock.document,
  },
  usePageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      publishPageToWorkspace: vi.fn(),
      setPageVisibility: vi.fn(),
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: headerMock.currentUserId } }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: { user: { id: string } }) => state.user.id,
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
      togglePageAgentPanel: vi.fn(),
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
      setRightPanelMode: vi.fn(),
    }),
  useStoreApi: () => ({
    getState: () => ({
      editor: {
        getDocument: () => '# Hello',
      },
      handleCopyLink: vi.fn(),
      handleDelete: vi.fn(),
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
    headerMock.activeWorkspaceId = 'workspace-1';
    headerMock.authorName = undefined;
    headerMock.document.updatedAt = undefined;
    headerMock.document.userId = headerMock.currentUserId;
    headerMock.document.visibility = 'private';
    headerMock.transferMenuItems.mockClear();
  });

  it('uses the Move action and does not expose a separate publish action', () => {
    const { result } = renderHook(() => useMenu());

    expect(headerMock.transferMenuItems).toHaveBeenCalledWith('doc-1', {
      defaultTargetVisibility: 'private',
      preferCurrentWorkspace: true,
      transferLabel: 'pageEditor.menu.move',
    });
    expect(getMenuItem(result.current.menuItems, 'transfer-document')).toMatchObject({
      label: 'Move',
    });
    expect(getMenuItem(result.current.menuItems, 'publish-to-workspace')).toBeUndefined();
  });

  it('renders the last edit footer as natural language without an icon', () => {
    headerMock.authorName = 'Lin';
    headerMock.document.updatedAt = '2026-07-15T08:30:00.000Z';

    const { result } = renderHook(() => useMenu());
    const infoItem = getMenuItem(result.current.menuItems, 'page-info');

    expect(infoItem?.icon).toBeUndefined();
    expect(renderToStaticMarkup(infoItem?.label)).toContain('Last edited on');
    expect(renderToStaticMarkup(infoItem?.label)).toContain('by Lin');
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
});
