import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_VERSION } from '@/const/version';
import { globalService } from '@/services/global';
import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';
import { switchLang } from '@/utils/client/switchLang';
import { withSWR } from '~test-utils';

vi.mock('@/utils/client/switchLang', () => ({
  switchLang: vi.fn(),
}));

vi.mock('@/services/global', () => ({
  globalService: {
    getLatestVersion: vi.fn(),
  },
}));

describe('generalActionSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGlobalStore.setState(initialState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateSystemStatus', () => {
    it('should not update status when not initialized', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.updateSystemStatus({ noWideScreen: false });
      });

      expect(result.current.status).toEqual(initialState.status);
    });

    it('should update status when initialized', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.updateSystemStatus({ noWideScreen: false });
      });

      expect(result.current.status.noWideScreen).toBe(false);
    });

    it('should not update if new status equals current status', () => {
      const { result } = renderHook(() => useGlobalStore());
      const saveToLocalStorageSpy = vi.spyOn(result.current.statusStorage, 'saveToLocalStorage');

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.updateSystemStatus({ noWideScreen: initialState.status.noWideScreen });
      });

      expect(saveToLocalStorageSpy).not.toHaveBeenCalled();
    });

    it('should save to localStorage when status is updated', () => {
      const { result } = renderHook(() => useGlobalStore());
      const saveToLocalStorageSpy = vi.spyOn(result.current.statusStorage, 'saveToLocalStorage');

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.updateSystemStatus({ noWideScreen: false });
      });

      expect(saveToLocalStorageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ noWideScreen: false }),
      );
    });

    it('should merge nested objects correctly', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.updateSystemStatus({
          expandSessionGroupKeys: ['test1', 'test2'],
        });
      });

      expect(result.current.status.expandSessionGroupKeys).toEqual(['test1', 'test2']);
    });
  });

  describe('switchLocale', () => {
    it('should update language in system status and call switchLang', () => {
      const { result } = renderHook(() => useGlobalStore());
      const locale = 'zh-CN';

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.switchLocale(locale);
      });

      expect(result.current.status.language).toBe(locale);
      expect(switchLang).toHaveBeenCalledWith(locale);
    });

    it('should not update language if status is not initialized', () => {
      const { result } = renderHook(() => useGlobalStore());
      const locale = 'zh-CN';

      act(() => {
        result.current.switchLocale(locale);
      });

      expect(result.current.status.language).toBeUndefined();
    });
  });

  describe('useInitSystemStatus', () => {
    it('should reset transient UI states when loading from localStorage', async () => {
      const mockStatus = {
        ...initialState.status,
        showCommandMenu: true,
        showHotkeyHelper: true,
        noWideScreen: false,
      };

      const { result } = renderHook(() => useGlobalStore());
      const getFromLocalStorageSpy = vi
        .spyOn(result.current.statusStorage, 'getFromLocalStorage')
        .mockResolvedValueOnce(mockStatus);

      const { result: hookResult } = renderHook(() => useGlobalStore().useInitSystemStatus(), {
        wrapper: withSWR,
      });

      await act(async () => {
        await hookResult.current.data;
      });

      expect(getFromLocalStorageSpy).toHaveBeenCalled();
      expect(useGlobalStore.getState().isStatusInit).toBe(true);
      expect(useGlobalStore.getState().status.showCommandMenu).toBe(false);
      expect(useGlobalStore.getState().status.showHotkeyHelper).toBe(false);
      expect(useGlobalStore.getState().status.noWideScreen).toBe(false);
    });
  });

  describe('useCheckLatestVersion', () => {
    it('should not fetch version when check is disabled', () => {
      const getLatestVersionSpy = vi.spyOn(globalService, 'getLatestVersion');

      renderHook(() => useGlobalStore().useCheckLatestVersion(false), {
        wrapper: withSWR,
      });

      expect(getLatestVersionSpy).not.toHaveBeenCalled();
    });

    it('should set hasNewVersion when major version is newer', async () => {
      const latestVersion = '999.0.0';
      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce(latestVersion);

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await act(async () => {
        await result.current.data;
      });

      expect(useGlobalStore.getState().hasNewVersion).toBe(true);
      expect(useGlobalStore.getState().latestVersion).toBe(latestVersion);
    });

    it('should not set hasNewVersion for same major.minor version', async () => {
      const currentParts = CURRENT_VERSION.split('.');
      const latestVersion = `${currentParts[0]}.${currentParts[1]}.999`;
      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce(latestVersion);

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await act(async () => {
        await result.current.data;
      });

      // Reset hasNewVersion and latestVersion
      useGlobalStore.setState({ hasNewVersion: undefined, latestVersion: undefined });

      expect(useGlobalStore.getState().hasNewVersion).toBeUndefined();
      expect(useGlobalStore.getState().latestVersion).toBeUndefined();
    });

    it('should not set hasNewVersion when version is invalid', async () => {
      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce('invalid.version');

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await act(async () => {
        await result.current.data;
      });

      // Reset hasNewVersion and latestVersion
      useGlobalStore.setState({ hasNewVersion: undefined, latestVersion: undefined });

      expect(useGlobalStore.getState().hasNewVersion).toBeUndefined();
      expect(useGlobalStore.getState().latestVersion).toBeUndefined();
    });
  });
});
