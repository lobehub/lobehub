import { renderHook } from '@testing-library/react';
import { uniq } from 'es-toolkit/compat';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import { HotkeyEnum, HotkeyScopeEnum } from '@/types/hotkey';

import { useHotkeyById } from './useHotkeyById';

// Mock dependencies
vi.mock('es-toolkit/compat', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    uniq: vi.fn((arr) => [...new Set(arr)]),
  };
});

// Mock react-hotkeys-hook
const mockRef = { current: document.createElement('div') };
const mockUseHotkeys = vi.fn(() => mockRef);

vi.mock('react-hotkeys-hook', () => ({
  // @ts-ignore
  useHotkeys: (...args: any[]) => mockUseHotkeys(...args),
}));

// Mock store and environment
let isMobileValue = false;
const mockHotkey = 'mod+k';

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: any) => any) => selector({ isMobile: isMobileValue }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector(),
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    getHotkeyById: () => () => mockHotkey,
  },
}));

vi.mock('@/utils/env', () => ({
  isDev: false,
}));

describe('useHotkeyById', () => {
  const mockCallback = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    isMobileValue = false;
  });

  it('should register hotkey with correct parameters', () => {
    const { result } = renderHook(() => useHotkeyById(HotkeyEnum.Search, mockCallback));

    // 验证 useHotkeys 被调用，但不检查具体函数引用
    expect(mockUseHotkeys).toHaveBeenCalled();

    // 获取实际调用参数
    const callArgs: any = mockUseHotkeys.mock.calls[0];

    // 验证第一个参数是正确的热键
    expect(callArgs[0]).toBe(mockHotkey);

    // 验证第二个参数是函数
    expect(typeof callArgs[1]).toBe('function');

    // 验证第三个参数包含预期的属性
    expect(callArgs[2]).toMatchObject({
      enableOnFormTags: true,
      preventDefault: true,
      scopes: [HotkeyEnum.Search, HotkeyScopeEnum.Global],
    });

    // 验证第四个参数是 undefined
    expect(callArgs[3]).toBeUndefined();

    // 验证返回值
    expect(result.current).toEqual({
      id: HotkeyEnum.Search,
      ref: mockRef,
    });
  });

  it('should disable hotkey on mobile devices', () => {
    // Set as mobile
    isMobileValue = true;

    renderHook(() => useHotkeyById(HotkeyEnum.Search, mockCallback, { enabled: true }));

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      mockHotkey,
      expect.any(Function),
      expect.objectContaining({
        enabled: false, // Should be disabled on mobile
      }),
      undefined,
    );
  });

  it('should handle options parameter correctly', () => {
    const options = {
      enabled: true,
      scopes: ['customScope'],
    };

    renderHook(() => useHotkeyById(HotkeyEnum.Search, mockCallback, options));

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      mockHotkey,
      expect.any(Function),
      expect.objectContaining({
        enabled: true,
        scopes: expect.arrayContaining([HotkeyEnum.Search, HotkeyScopeEnum.Global, 'customScope']),
      }),
      undefined,
    );

    expect(uniq).toHaveBeenCalled();
  });

  it('should handle dependencies parameter correctly', () => {
    const deps = [1, 2, 3];

    renderHook(() => useHotkeyById(HotkeyEnum.Search, mockCallback, deps));

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      mockHotkey,
      expect.any(Function),
      expect.any(Object),
      deps,
    );
  });

  it('should handle both options and dependencies correctly', () => {
    const options = { enabled: true };
    const deps = [1, 2, 3];

    renderHook(() => useHotkeyById(HotkeyEnum.Search, mockCallback, options, deps));

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      mockHotkey,
      expect.any(Function),
      expect.objectContaining({
        enabled: true,
      }),
      deps,
    );
  });

  it('should combine scopes from registration and options', () => {
    const testHotkeyId = HotkeyEnum.ToggleLeftPanel;
    const registrationItem = HOTKEYS_REGISTRATION.find((item) => item.id === testHotkeyId);
    const options = {
      scopes: ['customScope'],
    };

    renderHook(() => useHotkeyById(testHotkeyId, mockCallback, options));

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      mockHotkey,
      expect.any(Function),
      expect.objectContaining({
        scopes: expect.arrayContaining([
          testHotkeyId,
          ...(registrationItem?.scopes || []),
          'customScope',
        ]),
      }),
      undefined,
    );
  });

  it('should handle case when no registration item is found', () => {
    // Using a non-existent ID to test this case
    const nonExistentId = 'nonExistentId' as any;

    renderHook(() => useHotkeyById(nonExistentId, mockCallback));

    expect(mockUseHotkeys).toHaveBeenCalledWith(
      mockHotkey,
      expect.any(Function),
      expect.objectContaining({
        scopes: expect.arrayContaining([nonExistentId]),
      }),
      undefined,
    );
  });
});
