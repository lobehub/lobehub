import { HotkeyEnum, HotkeyGroupEnum, HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import type { HotkeyId } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';

import { useToggleTerminalPanelHotkey } from './chatScope';

const mocks = vi.hoisted(() => ({
  hotkeyCallback: undefined as (() => void) | undefined,
  toggleTerminalPanel: vi.fn(),
  useHotkeyById: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { toggleTerminalPanel: () => void }) => unknown) =>
    selector({ toggleTerminalPanel: mocks.toggleTerminalPanel }),
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
});
