/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicItemDropdownMenu } from './useDropdownMenu';

const locationFixture = vi.hoisted(() => ({ pathname: '/project/project-1/conversation/topic-1' }));
const removeMock = vi.hoisted(() => vi.fn());
const confirmDeleteMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/DeleteTopicConfirm', () => ({ confirmRemoveTopic: confirmDeleteMock }));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => locationFixture }));

const scopeFixture = vi.hoisted(() => ({ enabled: false }));
const refreshProjectMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const autoRenameMock = vi.hoisted(() => vi.fn());
const favoriteMock = vi.hoisted(() => vi.fn());
const completeMock = vi.hoisted(() => vi.fn());
const cloneMock = vi.hoisted(() => vi.fn());
vi.mock('../../useScopedTopics', () => ({
  useScopedTopic: () =>
    scopeFixture.enabled ? { id: 'topic-1', agentId: 'agent-other' } : undefined,
  useScopedTopics: () => ({
    scope: scopeFixture.enabled ? { projectId: 'project-1' } : null,
    refresh: refreshProjectMock,
  }),
}));
vi.mock('@/services/topic', () => ({ topicService: { cloneTopic: cloneMock } }));

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));
const versionMock = vi.hoisted(() => ({ isDesktop: false }));

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

vi.mock('@/components/RenameModal', () => ({
  openRenameModal: vi.fn(),
}));

vi.mock('@/const/version', () => ({
  get isDesktop() {
    return versionMock.isDesktop;
  },
}));

vi.mock('@/features/Electron/titlebar/RecentlyViewed/plugins', () => ({
  pluginRegistry: {
    parseUrl: vi.fn(),
  },
}));

vi.mock('@/features/ShareModal', () => ({
  openShareModal: vi.fn(),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
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

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeAgentId: 'agent-1' }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      autoRenameTopicTitle: autoRenameMock,
      duplicateTopic: vi.fn(),
      favoriteTopic: favoriteMock,
      markTopicCompleted: completeMock,
      removeTopic: removeMock,
      unmarkTopicCompleted: completeMock,
      updateTopicTitle: vi.fn(),
    }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ addTab: vi.fn() }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openTopicInNewWindow: vi.fn() }),
}));

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useTopicItemDropdownMenu>['dropdownMenu']>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('useTopicItemDropdownMenu', () => {
  beforeEach(() => {
    scopeFixture.enabled = false;
    vi.clearAllMocks();
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
    versionMock.isDesktop = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'execCommand');
  });

  it.each([
    ['copySessionId', 'topic-1'],
    ['copyLink', 'https://example.com/agent/agent-1/topic-1'],
  ])('copies %s when the Clipboard API is unavailable', async (key, expected) => {
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as never);
    let copiedText: string | undefined;
    const copy = vi.fn(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic 1' }),
    );
    const item = getMenuItem(result.current.dropdownMenu(), key);
    if (!item || !('onClick' in item)) throw new Error('Expected copy action');

    await item.onClick?.({} as never);

    expect(copy).toHaveBeenCalledWith('copy');
    expect(copiedText).toBe(expected);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it.each([
    ['/team/project/project-1/conversation/topic-1', true],
    ['/project/project-1/conversation/topic-other', false],
    ['/project/project-1/settings', false],
  ])(
    'after deleting a Project row at %s, navigates home only for the current Topic',
    async (pathname, shouldNavigate) => {
      scopeFixture.enabled = true;
      locationFixture.pathname = pathname;
      const { result } = renderHook(() =>
        useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic' }),
      );
      const item = getMenuItem(result.current.dropdownMenu(), 'delete');
      if (!item || !('onClick' in item)) throw new Error('Missing delete');
      item.onClick?.({} as never);
      await confirmDeleteMock.mock.calls[0][0].onConfirm(false);
      expect(removeMock).toHaveBeenCalledWith('topic-1', false);
      expect(refreshProjectMock).toHaveBeenCalledOnce();
      if (shouldNavigate) expect(navigateMock).toHaveBeenCalledWith('/project/project-1');
      else expect(navigateMock).not.toHaveBeenCalled();
    },
  );

  it('copies the row Agent link even when another Agent is active', async () => {
    scopeFixture.enabled = true;
    const writeText = vi.fn();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Other agent topic' }),
    );
    const item = getMenuItem(result.current.dropdownMenu(), 'copyLink');
    if (!item || !('onClick' in item)) throw new Error('Missing copy link');
    await item.onClick?.({} as never);
    expect(writeText).toHaveBeenCalledWith('https://example.com/agent/agent-other/topic-1');
  });

  it.each(['favorite', 'markCompleted'])(
    'refreshes the Project list immediately after %s',
    async (key) => {
      scopeFixture.enabled = true;
      const { result } = renderHook(() =>
        useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic' }),
      );
      const item = getMenuItem(result.current.dropdownMenu(), key);
      if (!item || !('onClick' in item)) throw new Error('Missing mutation');
      await item.onClick?.({} as never);
      expect(refreshProjectMock).toHaveBeenCalledOnce();
    },
  );

  it('auto-renames using messages from the row Agent', async () => {
    scopeFixture.enabled = true;
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic' }),
    );
    const item = getMenuItem(result.current.dropdownMenu(), 'autoRename');
    if (!item || !('onClick' in item)) throw new Error('Missing auto rename');
    await item.onClick?.({} as never);
    expect(autoRenameMock).toHaveBeenCalledWith('topic-1', 'agent-other');
    expect(refreshProjectMock).toHaveBeenCalledOnce();
  });

  it('duplicates a Project topic without requiring an Agent sidebar cache', async () => {
    scopeFixture.enabled = true;
    cloneMock.mockResolvedValue('topic-copy');
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic' }),
    );
    const item = getMenuItem(result.current.dropdownMenu(), 'duplicate');
    if (!item || !('onClick' in item)) throw new Error('Missing duplicate');
    await item.onClick?.({} as never);
    expect(cloneMock).toHaveBeenCalled();
    expect(refreshProjectMock).toHaveBeenCalledOnce();
    expect(navigateMock).toHaveBeenCalledWith('/project/project-1/conversation/topic-copy');
  });

  it('keeps project association out of the individual topic menu', () => {
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic' }),
    );
    expect(getMenuItem(result.current.dropdownMenu(), 'associate-project')).toBeUndefined();
  });

  it('groups desktop topic actions by intent', () => {
    versionMock.isDesktop = true;

    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic 1' }),
    );
    const items = result.current.dropdownMenu();

    expect(items.map((item) => (item && 'key' in item ? item.key : 'divider'))).toEqual([
      'markCompleted',
      'favorite',
      'divider',
      'autoRename',
      'rename',
      'diagnose',
      'divider',
      'openInNewTab',
      'openOnRight',
      'openInNewWindow',
      'divider',
      'copySessionId',
      'copyLink',
      'divider',
      'duplicate',
      'forwardToAgent',
      'moveToAgent',
      'divider',
      'share',
      'divider',
      'delete',
    ]);
    expect(getMenuItem(items, 'share')).toMatchObject({ label: 'shareModal.title' });
  });

  it('disables topic management actions for workspace viewers', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic 1' }),
    );
    const items = result.current.dropdownMenu();

    for (const key of [
      'markCompleted',
      'favorite',
      'autoRename',
      'rename',
      'duplicate',
      'moveToAgent',
      'share',
      'delete',
    ]) {
      expect(getMenuItem(items, key)).toMatchObject({ disabled: true });
    }

    expect(getMenuItem(items, 'copySessionId')).not.toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'copyLink')).not.toMatchObject({ disabled: true });
  });
});
