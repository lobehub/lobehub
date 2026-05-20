/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMenu } from './useMenu';

const messageSuccessMock = vi.hoisted(() => vi.fn());
const modalConfirmMock = vi.hoisted(() => vi.fn());
const openTopicInNewWindowMock = vi.hoisted(() => vi.fn());
const toggleWideScreenMock = vi.hoisted(() => vi.fn());
const favoriteTopicMock = vi.hoisted(() => vi.fn());
const autoRenameTopicTitleMock = vi.hoisted(() => vi.fn());
const removeTopicMock = vi.hoisted(() => vi.fn());
const updateTopicTitleMock = vi.hoisted(() => vi.fn());
const useLocationMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/RenameModal', () => ({
  openRenameModal: vi.fn(),
}));

vi.mock('@/const/version', () => ({
  isDesktop: true,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { success: messageSuccessMock },
      modal: { confirm: modalConfirmMock },
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => `${options?.ns ? `${options.ns}:` : ''}${key}`,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: useLocationMock,
  useParams: () => ({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentActiveTopic: (state: Record<string, unknown>) => state.activeTopic,
    currentTopicWorkingDirectory: (state: Record<string, unknown>) => state.workingDirectory,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeAgentId: 'agent-1',
      activeTopic: {
        favorite: false,
        id: 'topic-1',
        title: 'Topic 1',
      },
      autoRenameTopicTitle: autoRenameTopicTitleMock,
      favoriteTopic: favoriteTopicMock,
      removeTopic: removeTopicMock,
      updateTopicTitle: updateTopicTitleMock,
      workingDirectory: '/tmp/workdir',
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      openTopicInNewWindow: openTopicInNewWindowMock,
      toggleWideScreen: toggleWideScreenMock,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    wideScreen: () => false,
  },
}));

const isActionItem = (
  item: unknown,
): item is {
  key: string;
  label?: unknown;
  onClick?: () => void;
} => !!item && typeof item === 'object' && 'key' in item;

describe('Conversation header action menu', () => {
  it('includes the desktop popup-window action for the active topic', () => {
    useLocationMock.mockReturnValue({ pathname: '/agent/agent-1' });

    const { result } = renderHook(() => useMenu());

    const popupItem = result.current.menuItems.find(
      (item) => isActionItem(item) && item.key === 'openInPopupWindow',
    );

    expect(popupItem).toBeDefined();
    if (!isActionItem(popupItem)) {
      throw new Error('Expected popup menu item to be a clickable action item');
    }
    expect(popupItem?.label).toBe('topic:inPopup.title');

    act(() => {
      popupItem?.onClick?.();
    });

    expect(openTopicInNewWindowMock).toHaveBeenCalledWith('agent-1', 'topic-1');
  });

  it('does not include the popup-window action inside popup routes', () => {
    useLocationMock.mockReturnValue({ pathname: '/popup/agent/agent-1/topic-1' });

    const { result } = renderHook(() => useMenu());

    const popupItem = result.current.menuItems.find(
      (item) => isActionItem(item) && item.key === 'openInPopupWindow',
    );

    expect(popupItem).toBeUndefined();
  });
});
