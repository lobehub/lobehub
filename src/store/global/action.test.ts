import { act, renderHook, waitFor } from '@testing-library/react';
import { major, minor } from 'semver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_VERSION } from '@/const/version';
import { globalService } from '@/services/global';
import { useGlobalStore } from '@/store/global/index';
import { initialState } from '@/store/global/initialState';
import { withSWR } from '~test-utils';

vi.mock('zustand/traditional');

vi.mock('@/utils/client/switchLang', () => ({
  switchLang: vi.fn(),
}));

vi.mock('swr', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPreferenceSlice', () => {
  describe('toggleRightPanel', () => {
    it('should toggle chat sidebar', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.getState().updateSystemStatus({ showRightPanel: false });
        result.current.toggleRightPanel();
      });

      expect(result.current.status.showRightPanel).toBe(true);
    });
    it('should set chat sidebar to specified value', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.toggleRightPanel(true);
      });

      expect(result.current.status.showRightPanel).toBe(true);

      act(() => {
        result.current.toggleRightPanel(false);
      });

      expect(result.current.status.showRightPanel).toBe(false);
    });
  });

  describe('toggleExpandSessionGroup', () => {
    it('should toggle expand session group', () => {
      const { result } = renderHook(() => useGlobalStore());
      const groupId = 'group-id';

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.toggleExpandSessionGroup(groupId, true);
      });

      expect(result.current.status.expandSessionGroupKeys).toContain(groupId);
    });

    const groupId = 'group-id';
    const anotherGroupId = 'another-group-id';

    beforeEach(() => {
      // 确保每个测试前状态都是已初始化的
      useGlobalStore.setState({ isStatusInit: true });
    });

    it('should add group id when expanding and id not exists', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.toggleExpandSessionGroup(groupId, true);
      });

      expect(result.current.status.expandSessionGroupKeys).toEqual(['pinned', 'default', groupId]);
    });

    it('should not add duplicate group id when expanding', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        // 先添加一个组
        result.current.toggleExpandSessionGroup(groupId, true);
        // 再次尝试添加同一个组
        result.current.toggleExpandSessionGroup(groupId, true);
      });

      // 确保数组中只有一个实例
      expect(result.current.status.expandSessionGroupKeys).toEqual(['pinned', 'default', groupId]);
    });

    it('should remove group id when collapsing', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        // 先设置初始状态为展开
        result.current.toggleExpandSessionGroup(groupId, true);
        result.current.toggleExpandSessionGroup(anotherGroupId, true);

        // 验证初始状态
        // 收起第一个组
        result.current.toggleExpandSessionGroup(groupId, false);
      });

      // 验证只移除了指定的组
      expect(result.current.status.expandSessionGroupKeys).toEqual([
        'pinned',
        'default',
        anotherGroupId,
      ]);
    });

    it('should do nothing when collapsing non-existent group', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        // 先添加一个组
        result.current.toggleExpandSessionGroup(groupId, true);

        // 尝试收起一个不存在的组
        result.current.toggleExpandSessionGroup('non-existent-id', false);
      });

      // 验证原有的组没有受影响
      expect(result.current.status.expandSessionGroupKeys).toEqual(['pinned', 'default', groupId]);
    });

    it('should handle multiple groups correctly', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        // 添加多个组
        result.current.toggleExpandSessionGroup(groupId, true);
        result.current.toggleExpandSessionGroup(anotherGroupId, true);
        result.current.toggleExpandSessionGroup('third-group', true);
      });

      expect(result.current.status.expandSessionGroupKeys).toEqual([
        'pinned',
        'default',
        groupId,
        anotherGroupId,
        'third-group',
      ]);

      act(() => {
        // 收起中间的组
        result.current.toggleExpandSessionGroup(anotherGroupId, false);
      });

      expect(result.current.status.expandSessionGroupKeys).toEqual([
        'pinned',
        'default',
        groupId,
        'third-group',
      ]);
    });

    it('should save to localStorage when groups are toggled', () => {
      const { result } = renderHook(() => useGlobalStore());
      const saveToLocalStorageSpy = vi.spyOn(result.current.statusStorage, 'saveToLocalStorage');

      act(() => {
        result.current.toggleExpandSessionGroup(groupId, true);
      });

      expect(saveToLocalStorageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          expandSessionGroupKeys: ['pinned', 'default', groupId],
        }),
      );
    });
  });

  describe('toggleMobileTopic', () => {
    it('should toggle mobile topic', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.toggleMobileTopic();
      });

      expect(result.current.status.mobileShowTopic).toBe(true);
    });
  });

  describe('toggleMobilePortal', () => {
    it('should toggle mobile topic', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.toggleMobilePortal();
      });

      expect(result.current.status.mobileShowPortal).toBe(true);
    });
  });

  describe('toggleZenMode', () => {
    it('should toggle zen mode', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        // 初始值应该是 false
        expect(result.current.status.zenMode).toBe(false);

        result.current.toggleZenMode();
      });

      expect(result.current.status.zenMode).toBe(true);

      act(() => {
        result.current.toggleZenMode();
      });

      expect(result.current.status.zenMode).toBe(false);
    });
  });

  describe('toggleSystemRole', () => {
    it('should toggle system role', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.toggleSystemRole(true);
      });

      expect(result.current.status.showSystemRole).toBe(true);
    });
  });

  describe('updatePreference', () => {
    it('should update status', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        useGlobalStore.setState({ isStatusInit: true });
        result.current.updateSystemStatus({ noWideScreen: false });
      });

      expect(result.current.status.noWideScreen).toEqual(false);
    });
  });

  describe('switchBackToChat', () => {
    it('should switch back to chat', () => {
      const { result } = renderHook(() => useGlobalStore());
      const sessionId = 'session-id';
      const navigate = vi.fn();

      act(() => {
        useGlobalStore.setState({ navigate });
        result.current.switchBackToChat(sessionId);
      });

      expect(navigate).toHaveBeenCalledWith('/agent/session-id');
    });
  });

  describe('useCheckLatestVersion', () => {
    it('should set hasNewVersion to false if there is no new version', async () => {
      const latestVersion = '0.0.1';

      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce(latestVersion);

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toBe(latestVersion);
      });

      expect(useGlobalStore.getState().hasNewVersion).toBeUndefined();
      expect(useGlobalStore.getState().latestVersion).toBeUndefined();
    });

    it('should set hasNewVersion to true if there is a new version', async () => {
      const latestVersion = '10000000.0.0';

      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce(latestVersion);

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toBe(latestVersion);
      });

      expect(useGlobalStore.getState().hasNewVersion).toBe(true);
      expect(useGlobalStore.getState().latestVersion).toBe(latestVersion);
    });

    it('should set hasNewVersion to false if the version is same minor', async () => {
      const latestVersion = `${major(CURRENT_VERSION)}.${minor(CURRENT_VERSION)}.9999999`;

      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce(latestVersion);

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toBe(latestVersion);
      });

      expect(useGlobalStore.getState().hasNewVersion).toBeUndefined();
      expect(useGlobalStore.getState().latestVersion).toBeUndefined();
    });

    it('should set hasNewVersion to true if there is a minor version', async () => {
      const latestVersion = `${major(CURRENT_VERSION)}.${minor(CURRENT_VERSION) + 10}.0`;

      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce(latestVersion);

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toBe(latestVersion);
      });

      expect(useGlobalStore.getState().hasNewVersion).toBe(true);
      expect(useGlobalStore.getState().latestVersion).toBe(latestVersion);
    });

    it('should handle invalid latest version', async () => {
      const latestVersion = 'invalid.version';

      vi.spyOn(globalService, 'getLatestVersion').mockResolvedValueOnce(latestVersion);

      const { result } = renderHook(() => useGlobalStore().useCheckLatestVersion(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toBe(latestVersion);
      });

      expect(useGlobalStore.getState().hasNewVersion).toBeUndefined();
      expect(useGlobalStore.getState().latestVersion).toBeUndefined();
    });

    it('should not fetch version when check is disabled', () => {
      const getLatestVersionSpy = vi.spyOn(globalService, 'getLatestVersion');

      renderHook(() => useGlobalStore().useCheckLatestVersion(false), {
        wrapper: withSWR,
      });

      expect(getLatestVersionSpy).not.toHaveBeenCalled();
    });
  });

  describe('useInitGlobalPreference', () => {
    it('should init global status if there is empty object', async () => {
      vi.spyOn(useGlobalStore.getState().statusStorage, 'getFromLocalStorage').mockReturnValueOnce(
        {} as any,
      );

      const { result } = renderHook(() => useGlobalStore().useInitSystemStatus(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toEqual({});
      });

      expect(useGlobalStore.getState().status).toEqual(initialState.status);
    });

    it('should update with data', async () => {
      const { result } = renderHook(() => useGlobalStore());
      vi.spyOn(useGlobalStore.getState().statusStorage, 'getFromLocalStorage').mockReturnValueOnce({
        noWideScreen: false,
      } as any);

      const { result: hooks } = renderHook(() => result.current.useInitSystemStatus(), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(hooks.current.data).toEqual({ noWideScreen: false });
      });

      expect(result.current.status.noWideScreen).toEqual(false);
    });
  });
});
