import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HotkeyId } from '@/types/hotkey';

import { isTaskPanelRoute, useToggleRightPanelHotkey } from './globalScope';

interface MockGlobalState {
  status: { zenMode: boolean };
  toggleRightPanel: () => void;
  toggleTaskAgentPanel: () => void;
  updateSystemStatus: () => void;
}

type HotkeyRegistrationArgs = [HotkeyId, () => void, ...unknown[]];

const mocks = vi.hoisted(() => ({
  hotkeyCallback: undefined as (() => void) | undefined,
  pathname: '/',
  toggleRightPanel: vi.fn(),
  toggleTaskAgentPanel: vi.fn(),
  useHotkeyById: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mocks.pathname }),
}));

vi.mock('@/hooks/useNavigateToAgent', () => ({
  useNavigateToAgent: () => vi.fn(),
}));

vi.mock('@/hooks/usePinnedAgentState', () => ({
  usePinnedAgentState: () => [undefined, { unpinAgent: vi.fn() }],
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: MockGlobalState) => unknown) =>
    selector({
      status: { zenMode: false },
      toggleRightPanel: mocks.toggleRightPanel,
      toggleTaskAgentPanel: mocks.toggleTaskAgentPanel,
      updateSystemStatus: vi.fn(),
    }),
}));

vi.mock('./useHotkeyById', () => ({
  useHotkeyById: (...args: HotkeyRegistrationArgs) => mocks.useHotkeyById(...args),
}));

describe('globalScope hotkeys', () => {
  beforeEach(() => {
    mocks.hotkeyCallback = undefined;
    mocks.pathname = '/';
    mocks.toggleRightPanel.mockReset();
    mocks.toggleTaskAgentPanel.mockReset();
    mocks.useHotkeyById.mockReset();
    mocks.useHotkeyById.mockImplementation((_, callback) => {
      mocks.hotkeyCallback = callback;
      return { id: HotkeyEnum.ToggleRightPanel };
    });
  });

  describe('isTaskPanelRoute', () => {
    it('should match task panel routes only', () => {
      expect(isTaskPanelRoute('/tasks')).toBe(true);
      expect(isTaskPanelRoute('/tasks/filter')).toBe(true);
      expect(isTaskPanelRoute('/task/T-1')).toBe(true);
      expect(isTaskPanelRoute('/agent/inbox')).toBe(false);
      expect(isTaskPanelRoute('/task-template')).toBe(false);
    });
  });

  describe('useToggleRightPanelHotkey', () => {
    it('should toggle task agent panel on task routes', () => {
      mocks.pathname = '/tasks';

      renderHook(() => useToggleRightPanelHotkey());

      act(() => {
        mocks.hotkeyCallback?.();
      });

      expect(mocks.toggleTaskAgentPanel).toHaveBeenCalledTimes(1);
      expect(mocks.toggleRightPanel).not.toHaveBeenCalled();
    });

    it('should toggle task agent panel on task detail routes', () => {
      mocks.pathname = '/task/T-1';

      renderHook(() => useToggleRightPanelHotkey());

      act(() => {
        mocks.hotkeyCallback?.();
      });

      expect(mocks.toggleTaskAgentPanel).toHaveBeenCalledTimes(1);
      expect(mocks.toggleRightPanel).not.toHaveBeenCalled();
    });

    it('should keep toggling the generic right panel on non-task routes', () => {
      mocks.pathname = '/agent/inbox';

      renderHook(() => useToggleRightPanelHotkey());

      act(() => {
        mocks.hotkeyCallback?.();
      });

      expect(mocks.toggleRightPanel).toHaveBeenCalledTimes(1);
      expect(mocks.toggleTaskAgentPanel).not.toHaveBeenCalled();
    });
  });
});
