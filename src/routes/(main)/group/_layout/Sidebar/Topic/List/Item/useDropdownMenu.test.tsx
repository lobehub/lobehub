/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicItemDropdownMenu } from './useDropdownMenu';

const favoriteMenuItemMock = vi.hoisted(() =>
  vi.fn((target?: unknown) => (target ? { key: 'toggleFavorite', label: 'favorite.add' } : null)),
);
vi.mock('@/features/Favorites', () => ({ useFavoriteMenuItem: favoriteMenuItemMock }));

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));
const workspaceMock = vi.hoisted(() => ({ slug: null as string | null }));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: {
    useApp: () => ({
      message: {
        success: vi.fn(),
      },
      modal: {
        confirm: vi.fn(),
      },
    }),
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => workspaceMock.slug,
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

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.com',
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeGroupId: 'group-1' }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      autoRenameTopicTitle: vi.fn(),
      duplicateTopic: vi.fn(),
      markTopicCompleted: vi.fn(),
      removeTopic: vi.fn(),
      unmarkTopicCompleted: vi.fn(),
    }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ addTab: vi.fn() }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openGroupTopicInNewWindow: vi.fn() }),
}));

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useTopicItemDropdownMenu>>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('group useTopicItemDropdownMenu', () => {
  beforeEach(() => {
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
    workspaceMock.slug = null;
  });

  it('disables topic management actions for workspace viewers', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({
        id: 'topic-1',
        title: 'Topic 1',
        toggleEditing: vi.fn(),
      }),
    );
    const items = result.current();

    for (const key of ['markCompleted', 'autoRename', 'rename', 'duplicate', 'delete']) {
      expect(getMenuItem(items, key)).toMatchObject({ disabled: true });
    }

    expect(getMenuItem(items, 'copySessionId')).not.toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'copyLink')).not.toMatchObject({ disabled: true });
  });

  const copyLink = (items: ReturnType<ReturnType<typeof useTopicItemDropdownMenu>>) => {
    const item = getMenuItem(items, 'copyLink');
    if (!item || !('onClick' in item)) throw new Error('Missing copy link');
    (item.onClick as () => void)();
  };

  it('copies the personal link outside a workspace', () => {
    const writeText = vi.fn();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic 1', toggleEditing: vi.fn() }),
    );

    copyLink(result.current());

    expect(writeText).toHaveBeenCalledWith('https://example.com/group/group-1/topic-1');
  });

  it('keeps the active workspace prefix in the copied link', () => {
    workspaceMock.slug = 'lobehub';
    const writeText = vi.fn();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic 1', toggleEditing: vi.fn() }),
    );

    copyLink(result.current());

    expect(writeText).toHaveBeenCalledWith('https://example.com/lobehub/group/group-1/topic-1');
  });

  it('favorites the topic by its group chat link', () => {
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic 1', toggleEditing: vi.fn() }),
    );

    expect(result.current().map((item) => item && 'key' in item && item.key)).toContain(
      'toggleFavorite',
    );
    expect(favoriteMenuItemMock).toHaveBeenLastCalledWith(
      {
        path: '/group/group-1/topic-1',
        snapshotReady: true,
        targetId: 'topic-1',
        title: 'Topic 1',
        type: 'topic',
      },
      { showHotkey: false },
    );
  });
});
