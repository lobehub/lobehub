/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatItemContextMenu } from './useChatItemContextMenu';

const mocks = vi.hoisted(() => ({
  copyMessage: vi.fn(),
  delAndRegenerateMessage: vi.fn(),
  delAndResendThreadMessage: vi.fn(),
  deleteMessage: vi.fn(),
  isHeterogeneous: false,
  message: { content: 'hello', id: 'message-1', role: 'user' },
  openThreadCreator: vi.fn(),
  regenerateAssistantMessage: vi.fn(),
  regenerateUserMessage: vi.fn(),
  resendThreadMessage: vi.fn(),
  showContextMenu: vi.fn(),
  startMessageTTS: vi.fn(),
  toggleMessageCollapsed: vi.fn(),
  toggleMessageEditing: vi.fn(),
  translateMessage: vi.fn(),
}));

vi.mock('@/features/Conversation/ChatItem/components/MessageContent', () => ({
  MSG_CONTENT_CLASSNAME: 'message-content',
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/libs/contextMenu', () => ({
  showContextMenu: mocks.showContextMenu,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    isCurrentAgentHeterogeneous: (state: typeof mocks) => state.isHeterogeneous,
  },
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: { isGroup: boolean }) => unknown) =>
    selector({ isGroup: false }),
}));

vi.mock('@/store/session/selectors', () => ({
  sessionSelectors: {
    isCurrentSessionGroupSession: (state: { isGroup: boolean }) => state.isGroup,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { contextMenuMode: string; isDevMode: boolean }) => unknown) =>
    selector({ contextMenuMode: 'system', isDevMode: false }),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    config: (state: { isDevMode: boolean }) => ({ isDevMode: state.isDevMode }),
    contextMenuMode: (state: { contextMenuMode: string }) => state.contextMenuMode,
  },
}));

vi.mock('../components/ShareMessageModal', () => ({
  openShareMessageModal: vi.fn(),
}));

vi.mock('../store', () => {
  const state = {
    ...mocks,
    context: {},
    hooks: {},
    skipFetch: false,
  };

  return {
    createStore: vi.fn(),
    dataSelectors: {
      getDisplayMessageById: () => () => mocks.message,
    },
    messageStateSelectors: {
      hasThreadBySourceMsgId: () => () => false,
      isMessageCollapsed: () => () => false,
      isMessageRegenerating: () => () => false,
      isThreadMode: () => false,
    },
    useConversationStore: (selector: (value: typeof state) => unknown) => selector(state),
    useConversationStoreApi: () => ({ getState: () => state }),
  };
});

vi.mock('./useChatListActionsBar', () => ({
  useChatListActionsBar: () => ({
    branching: { key: 'branching', label: 'Branch' },
    collapse: { key: 'collapse', label: 'Collapse' },
    copy: { key: 'copy', label: 'Copy' },
    del: { danger: true, key: 'del', label: 'Delete' },
    delAndRegenerate: { key: 'delAndRegenerate', label: 'Delete and regenerate' },
    divider: { type: 'divider' },
    edit: { key: 'edit', label: 'Edit' },
    expand: { key: 'expand', label: 'Expand' },
    regenerate: { key: 'regenerate', label: 'Regenerate' },
    share: { key: 'share', label: 'Share' },
    translate: { key: 'translate', label: 'Translate' },
    tts: { key: 'tts', label: 'TTS' },
  }),
}));

vi.mock('./useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const openContextMenu = () => {
  const { result } = renderHook(() =>
    useChatItemContextMenu({ id: 'message-1', inPortalThread: false }),
  );
  const target = document.createElement('div');
  target.className = 'message-content';
  document.body.append(target);

  act(() => {
    result.current.handleContextMenu({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target,
    } as unknown as MouseEvent<HTMLDivElement>);
  });

  target.remove();
  return mocks.showContextMenu.mock.calls.at(-1)?.[0] as Array<{ key?: string }>;
};

describe('useChatItemContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHeterogeneous = false;
  });

  it('omits delete for heterogeneous-agent messages', () => {
    mocks.isHeterogeneous = true;

    expect(openContextMenu().map((item) => item.key)).not.toContain('del');
  });

  it('keeps delete for ordinary-agent messages', () => {
    expect(openContextMenu().map((item) => item.key)).toContain('del');
  });
});
