import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatItemContextMenu } from './useChatItemContextMenu';

const MSG_CONTENT_CLASSNAME = 'msg-content';

const mocks = vi.hoisted(() => ({
  messages: {} as Record<string, any>,
  openShareMessageModal: vi.fn(),
  showContextMenu: vi.fn(),
}));

vi.mock('@/features/Conversation/ChatItem/components/MessageContent', () => ({
  MSG_CONTENT_CLASSNAME: 'msg-content',
}));
vi.mock('@/features/Conversation/Error/heterogeneous', () => ({
  resolveHeteroErroredStepId: () => undefined,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/libs/contextMenu', () => ({ showContextMenu: mocks.showContextMenu }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) => selector({ forkTopic: vi.fn() }),
}));
vi.mock('@/store/session', () => ({ useSessionStore: () => false }));
vi.mock('@/store/session/selectors', () => ({ sessionSelectors: {} }));
vi.mock('@/store/user', () => ({ useUserStore: () => false }));
vi.mock('@/store/user/selectors', () => ({ userGeneralSettingsSelectors: {} }));

vi.mock('../components/ShareMessageModal', () => ({
  openShareMessageModal: mocks.openShareMessageModal,
}));
vi.mock('./useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
}));
vi.mock('./useChatListActionsBar', () => {
  const item = (key: string) => ({ key, label: key });
  return {
    useChatListActionsBar: () => ({
      branching: item('branching'),
      collapse: item('collapse'),
      copy: item('copy'),
      del: item('del'),
      delAndRegenerate: item('delAndRegenerate'),
      divider: { type: 'divider' },
      edit: item('edit'),
      expand: item('expand'),
      fork: item('fork'),
      regenerate: item('regenerate'),
      share: item('share'),
      translate: item('translate'),
    }),
  };
});
vi.mock('../store', () => {
  const state = () => ({
    context: { agentId: 'agent-1', topicId: 'topic-1' },
    hooks: {},
    messages: mocks.messages,
    skipFetch: false,
  });
  const alwaysFalse = () => () => false;

  return {
    createStore: vi.fn(),
    dataSelectors: {
      getDisplayMessageById: (id: string) => (s: ReturnType<typeof state>) => s.messages[id],
    },
    messageStateSelectors: {
      hasThreadBySourceMsgId: alwaysFalse,
      isMessageCollapsed: alwaysFalse,
      isMessageRegenerating: alwaysFalse,
      isThreadMode: () => false,
    },
    useConversationStore: (selector: (s: object) => unknown) => selector(state()),
    useConversationStoreApi: () => ({ getState: state }),
  };
});

const rightClickAndChoose = (id: string, key: string) => {
  const { result } = renderHook(() => useChatItemContextMenu({ id, inPortalThread: false }));

  const target = document.createElement('div');
  target.className = MSG_CONTENT_CLASSNAME;
  document.body.append(target);

  act(() => {
    result.current.handleContextMenu({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target,
    } as unknown as MouseEvent<HTMLDivElement>);
  });

  const items = mocks.showContextMenu.mock.calls.at(-1)?.[0] as { key?: string; onClick?: any }[];
  const item = items.find((menuItem) => menuItem.key === key);
  expect(item).toBeDefined();

  act(() => {
    item!.onClick({ key, keyPath: [key] });
  });

  target.remove();
};

describe('useChatItemContextMenu share', () => {
  beforeEach(() => {
    mocks.openShareMessageModal.mockClear();
    mocks.showContextMenu.mockClear();
    mocks.messages = {};
  });

  it('opens the share modal for a multi-step reply', async () => {
    const group = {
      children: [
        { content: 'Let me draw it.', id: 'step-1', tools: [] },
        { content: 'Here is the picture.', id: 'step-2', imageList: [] },
      ],
      content: '',
      id: 'step-1',
      role: 'assistantGroup',
    };
    mocks.messages = { 'step-1': group };

    rightClickAndChoose('step-1', 'share');

    await vi.waitFor(() => expect(mocks.openShareMessageModal).toHaveBeenCalledTimes(1));
    expect(mocks.openShareMessageModal.mock.calls[0][0]).toBe(group);
  });

  it('still opens the share modal for a single reply', async () => {
    const reply = { content: 'Hi there', id: 'msg-1', role: 'assistant' };
    mocks.messages = { 'msg-1': reply };

    rightClickAndChoose('msg-1', 'share');

    await vi.waitFor(() => expect(mocks.openShareMessageModal).toHaveBeenCalledTimes(1));
    expect(mocks.openShareMessageModal.mock.calls[0][0]).toBe(reply);
  });
});
