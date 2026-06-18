/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDropdownMenu } from './useDropdownMenu';

const confirmModalMock = vi.hoisted(() => vi.fn());
const removeTopicMock = vi.hoisted(() => vi.fn());
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

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: confirmModalMock,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        success: vi.fn(),
      },
    }),
  },
}));

vi.mock('@/components/RenameModal', () => ({
  openRenameModal: vi.fn(),
}));

vi.mock('@/const/url', () => ({
  SESSION_CHAT_TOPIC_URL: (agentId: string, topicId: string) => `/agent/${agentId}/${topicId}`,
}));

vi.mock('@/const/version', () => ({
  isDesktop: true,
}));

vi.mock('@/features/ShareModal', () => ({
  openShareModal: vi.fn(),
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

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      autoRenameTopicTitle: vi.fn(),
      duplicateTopic: vi.fn(),
      favoriteTopic: vi.fn(),
      markTopicCompleted: vi.fn(),
      removeTopic: removeTopicMock,
      unmarkTopicCompleted: vi.fn(),
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

interface TestMenuItem {
  disabled?: boolean;
  key?: PropertyKey;
  onClick?: () => void;
}

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useDropdownMenu>>>,
  key: string,
): TestMenuItem | undefined =>
  items.find((item) => item && 'key' in item && item.key === key) as TestMenuItem | undefined;

describe('PageEditor Copilot TopicSelector useDropdownMenu', () => {
  beforeEach(() => {
    confirmModalMock.mockReset();
    removeTopicMock.mockReset();
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
  });

  it('renders the full topic action set in the selector menu', () => {
    const { result } = renderHook(() =>
      useDropdownMenu({
        agentId: 'agent-1',
        fav: false,
        onClose: vi.fn(),
        status: 'active',
        topicId: 'topic-1',
        topicTitle: 'Topic 1',
      }),
    );

    const keys = result.current()?.flatMap((item) => (item && 'key' in item ? [item.key] : []));

    expect(keys).toEqual([
      'markCompleted',
      'favorite',
      'autoRename',
      'rename',
      'openInNewTab',
      'openInNewWindow',
      'copySessionId',
      'copyLink',
      'duplicate',
      'share',
      'delete',
    ]);
  });

  it('disables write actions for viewers but keeps copy actions available', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() =>
      useDropdownMenu({
        agentId: 'agent-1',
        onClose: vi.fn(),
        topicId: 'topic-1',
        topicTitle: 'Topic 1',
      }),
    );
    const items = result.current();

    for (const key of [
      'markCompleted',
      'favorite',
      'autoRename',
      'rename',
      'duplicate',
      'share',
      'delete',
    ]) {
      expect(getMenuItem(items, key)).toMatchObject({ disabled: true });
    }

    expect(getMenuItem(items, 'copySessionId')).not.toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'copyLink')).not.toMatchObject({ disabled: true });
  });

  it('removes the topic and closes the selector from the delete confirmation', async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();

    const { result } = renderHook(() =>
      useDropdownMenu({
        agentId: 'agent-1',
        onClose,
        onDelete,
        topicId: 'topic-1',
        topicTitle: 'Topic 1',
      }),
    );

    getMenuItem(result.current(), 'delete')?.onClick?.();
    const config = confirmModalMock.mock.calls[0][0];
    await config.onOk();

    expect(removeTopicMock).toHaveBeenCalledWith('topic-1');
    expect(onDelete).toHaveBeenCalledWith('topic-1');
    expect(onClose).toHaveBeenCalled();
  });
});
