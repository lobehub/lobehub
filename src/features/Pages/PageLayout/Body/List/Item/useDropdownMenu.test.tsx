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
  usePageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      duplicatePage: vi.fn(),
      removePage: vi.fn(),
    }),
}));

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useDropdownMenu>>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('Page list item dropdown menu', () => {
  beforeEach(() => {
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
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
});
