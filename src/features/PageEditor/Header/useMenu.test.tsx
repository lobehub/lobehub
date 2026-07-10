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
  useActiveWorkspaceId: () => undefined,
}));

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: () => undefined,
}));

vi.mock('@/business/client/hooks/useDocumentTransferMenuItem', () => ({
  useDocumentTransferMenuItem: () => null,
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
    getDocumentById: (_id: string) => (_s: unknown) => undefined,
  },
  usePageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      publishPageToWorkspace: vi.fn(),
      setPageVisibility: vi.fn(),
    }),
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
