/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSendMenuItems as useGroupSendMenuItems } from '@/routes/(main)/group/features/Conversation/MainChatInput/useSendMenuItems';

import { useSendMenuItems as useAgentSendMenuItems } from './useSendMenuItems';

const mocks = vi.hoisted(() => ({
  addAIMessage: vi.fn(),
  addUserMessage: vi.fn(),
  clearContent: vi.fn(),
  editorContent: '',
  focus: vi.fn(),
  inputMessage: '',
  updatePreference: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => children,
  Hotkey: () => null,
  Icon: () => null,
}));

vi.mock('react-i18next', () => ({
  Trans: () => null,
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Conversation', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      editor: {
        clearContent: mocks.clearContent,
        focus: mocks.focus,
        getMarkdownContent: () => mocks.editorContent,
      },
    }),
  useConversationStoreApi: () => ({
    getState: () => ({
      addAIMessage: mocks.addAIMessage,
      addUserMessage: mocks.addUserMessage,
      inputMessage: mocks.inputMessage,
    }),
  }),
}));

vi.mock('@/hooks/useHotkeys', () => ({
  useAddUserMessageHotkey: vi.fn(),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updatePreference: mocks.updatePreference }),
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: { useCmdEnterToSend: () => false },
  settingsSelectors: { getHotkeyById: () => () => [] },
}));

type MenuAction = { key?: string; onClick?: () => void };

const getAddAIAction = (items: unknown) =>
  (items as MenuAction[]).find((item) => item?.key === 'addAi');

describe.each([
  ['agent', useAgentSendMenuItems],
  ['group', useGroupSendMenuItems],
])('%s conversation send menu', (_name, useSendMenuItems) => {
  beforeEach(() => {
    mocks.editorContent = '';
    mocks.inputMessage = '';
    vi.clearAllMocks();
  });

  it('adds the current editor text as an assistant message', () => {
    mocks.editorContent = 'assistant content';
    mocks.inputMessage = 'stale cached content';
    const { result } = renderHook(() => useSendMenuItems());

    act(() => getAddAIAction(result.current)?.onClick?.());

    expect(mocks.addAIMessage).toHaveBeenCalledWith('assistant content');
    expect(mocks.clearContent).toHaveBeenCalledOnce();
    expect(mocks.focus).toHaveBeenCalledOnce();
  });

  it('preserves support for empty assistant placeholders', () => {
    const { result } = renderHook(() => useSendMenuItems());

    act(() => getAddAIAction(result.current)?.onClick?.());

    expect(mocks.addAIMessage).toHaveBeenCalledWith('');
  });
});
