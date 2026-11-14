import {
  HotkeyEnum,
  HotkeyGroupEnum,
  HOTKEYS_REGISTRATION,
  HotkeyScopeEnum,
} from '@lobechat/const/hotkeys';
import type { HotkeyId } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAddUserMessageHotkey,
  useFindInTopicHotkey,
  useToggleTerminalPanelHotkey,
} from './chatScope';

const mocks = vi.hoisted(() => ({
  disableScope: vi.fn(),
  enableScope: vi.fn(),
  hotkeyCallback: undefined as (() => void) | undefined,
  openWorkingSidebar: vi.fn(),
  toggleTerminalPanel: vi.fn(),
  useHotkeyById: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: {
      openWorkingSidebar: (tab?: string) => void;
      toggleTerminalPanel: () => void;
    }) => unknown,
  ) =>
    selector({
      openWorkingSidebar: mocks.openWorkingSidebar,
      toggleTerminalPanel: mocks.toggleTerminalPanel,
    }),
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeysContext: () => ({ disableScope: mocks.disableScope, enableScope: mocks.enableScope }),
}));

vi.mock('./useHotkeyById', () => ({
  useHotkeyById: (id: HotkeyId, callback: () => void, options?: unknown) => {
    mocks.hotkeyCallback = callback;
    mocks.useHotkeyById(id, callback, options);
    return { id };
  },
}));

describe('useToggleTerminalPanelHotkey', () => {
  beforeEach(() => {
    mocks.hotkeyCallback = undefined;
    mocks.toggleTerminalPanel.mockReset();
    mocks.useHotkeyById.mockReset();
  });

  it('toggles the terminal panel when its hotkey is invoked', () => {
    renderHook(() => useToggleTerminalPanelHotkey());

    act(() => {
      mocks.hotkeyCallback?.();
    });

    expect(mocks.useHotkeyById).toHaveBeenCalledWith(
      HotkeyEnum.ToggleTerminalPanel,
      expect.any(Function),
      {
        enableOnContentEditable: true,
        enabled: true,
      },
    );
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledTimes(1);
  });

  it('uses the VS Code Ctrl+` binding in the chat scope', () => {
    expect(HOTKEYS_REGISTRATION).toContainEqual({
      group: HotkeyGroupEnum.Conversation,
      id: HotkeyEnum.ToggleTerminalPanel,
      keys: 'ctrl+backquote',
      scopes: [HotkeyScopeEnum.Chat],
    });
  });

  it('leaves the binding off when the caller has no shell to open', () => {
    renderHook(() => useToggleTerminalPanelHotkey(false));

    expect(mocks.useHotkeyById).toHaveBeenCalledWith(
      HotkeyEnum.ToggleTerminalPanel,
      expect.any(Function),
      {
        enableOnContentEditable: true,
        enabled: false,
      },
    );
  });
});

describe('useFindInTopicHotkey', () => {
  beforeEach(() => {
    mocks.hotkeyCallback = undefined;
    mocks.openWorkingSidebar.mockReset();
    mocks.useHotkeyById.mockReset();
  });

  it('opens the search tab of the working sidebar', () => {
    renderHook(() => useFindInTopicHotkey(true));

    act(() => {
      mocks.hotkeyCallback?.();
    });

    expect(mocks.useHotkeyById).toHaveBeenCalledWith(HotkeyEnum.FindInTopic, expect.any(Function), {
      enableOnContentEditable: true,
      enabled: true,
    });
    expect(mocks.openWorkingSidebar).toHaveBeenCalledWith('search');
  });

  it('takes over Mod+F in the chat scope', () => {
    expect(HOTKEYS_REGISTRATION).toContainEqual({
      group: HotkeyGroupEnum.Conversation,
      id: HotkeyEnum.FindInTopic,
      keys: 'mod+f',
      scopes: [HotkeyScopeEnum.Chat],
    });
  });
});

describe('useAddUserMessageHotkey', () => {
  beforeEach(() => {
    mocks.disableScope.mockReset();
    mocks.enableScope.mockReset();
  });

  it('enables its scope for as long as it is mounted, without re-toggling on re-render', () => {
    const { rerender, unmount } = renderHook(({ send }) => useAddUserMessageHotkey(send), {
      initialProps: { send: vi.fn() },
    });
    rerender({ send: vi.fn() });

    expect(mocks.enableScope).toHaveBeenCalledTimes(1);
    expect(mocks.enableScope).toHaveBeenCalledWith(HotkeyEnum.AddUserMessage);
    expect(mocks.disableScope).not.toHaveBeenCalled();

    unmount();

    expect(mocks.disableScope).toHaveBeenCalledWith(HotkeyEnum.AddUserMessage);
  });
});
