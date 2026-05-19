import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { type GlobalServerConfig } from '@/types/serverConfig';
import { type UserInitializationState, type UserPreference } from '@/types/user';
import { withSWR } from '~test-utils';

vi.mock('zustand/traditional');

vi.mock('swr', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    mutate: vi.fn(),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCommonSlice', () => {
  describe('updateAvatar', () => {
    it('should update avatar', async () => {
      const { result } = renderHook(() => useUserStore());
      const avatar = 'data:image/png;base64,';

      const spyOn = vi.spyOn(result.current, 'refreshUserState');
      const updateAvatarSpy = vi.spyOn(userService, 'updateAvatar').mockResolvedValue({} as any);

      await act(async () => {
        await result.current.updateAvatar(avatar);
      });

      expect(updateAvatarSpy).toHaveBeenCalledWith('data:image/png;base64,');
      expect(spyOn).toHaveBeenCalled();
    });
  });

  describe('updateInterests', () => {
    it('optimistically updates user.interests before the service call resolves', async () => {
      act(() => {
        useUserStore.setState({ user: { id: 'u1', interests: ['old'] } as any });
      });

      let resolveService: () => void = () => {};
      const updateSpy = vi.spyOn(userService, 'updateInterests').mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveService = r;
          }) as any,
      );

      let pending: Promise<void> | undefined;
      await act(async () => {
        pending = useUserStore.getState().updateInterests(['new']);
        // Drain the queue-then-mock microtask chain so `resolveService` points
        // at the real resolver before we call it below.
        await Promise.resolve();
        await Promise.resolve();
      });

      // optimistic: interests reflect the new value immediately
      expect(useUserStore.getState().user?.interests).toEqual(['new']);

      await act(async () => {
        resolveService();
        await pending;
      });

      expect(updateSpy).toHaveBeenCalledWith(['new']);
    });

    it('rolls back user.interests when the service call fails', async () => {
      act(() => {
        useUserStore.setState({ user: { id: 'u1', interests: ['old'] } as any });
      });

      vi.spyOn(userService, 'updateInterests').mockRejectedValue(new Error('boom'));

      await expect(useUserStore.getState().updateInterests(['new'])).rejects.toThrow('boom');

      expect(useUserStore.getState().user?.interests).toEqual(['old']);
    });

    it('skips rollback when a later edit has already superseded the optimistic value', async () => {
      act(() => {
        useUserStore.setState({ user: { id: 'u1', interests: ['old'] } as any });
      });

      vi.spyOn(userService, 'updateInterests').mockRejectedValue(new Error('boom'));

      const pending = useUserStore.getState().updateInterests(['new']);

      // Simulate a second edit landing before the first request rejects.
      act(() => {
        useUserStore.setState({ user: { id: 'u1', interests: ['newer'] } as any });
      });

      await expect(pending).rejects.toThrow('boom');

      // The rollback must not clobber the newer in-flight value.
      expect(useUserStore.getState().user?.interests).toEqual(['newer']);
    });

    it('preserves concurrent updates to other user fields during rollback', async () => {
      act(() => {
        useUserStore.setState({
          user: { id: 'u1', avatar: 'old.png', interests: ['old'] } as any,
        });
      });

      vi.spyOn(userService, 'updateInterests').mockRejectedValue(new Error('boom'));

      const pending = useUserStore.getState().updateInterests(['new']);

      // Simulate `updateAvatar` landing while the interests request is in flight.
      act(() => {
        useUserStore.setState({
          user: { id: 'u1', avatar: 'new.png', interests: ['new'] } as any,
        });
      });

      await expect(pending).rejects.toThrow('boom');

      const user = useUserStore.getState().user as any;
      expect(user.interests).toEqual(['old']); // rolled back
      expect(user.avatar).toBe('new.png'); // concurrent avatar update kept
    });

    it('serializes service calls and refreshes only after the latest one', async () => {
      act(() => {
        useUserStore.setState({ user: { id: 'u1', interests: [] } as any });
      });

      const order: string[] = [];
      const resolvers: Array<() => void> = [];
      vi.spyOn(userService, 'updateInterests').mockImplementation(((tag: string[]) => {
        order.push(`start:${tag.join(',')}`);
        return new Promise<void>((r) => {
          resolvers.push(() => {
            order.push(`end:${tag.join(',')}`);
            r();
          });
        });
      }) as any);

      const refreshSpy = vi.spyOn(useUserStore.getState(), 'refreshUserState').mockResolvedValue();

      let first: Promise<void> | undefined;
      let second: Promise<void> | undefined;
      await act(async () => {
        first = useUserStore.getState().updateInterests(['a']);
        second = useUserStore.getState().updateInterests(['a', 'b']);
        // Drain microtasks so the first request reaches the service.
        await Promise.resolve();
        await Promise.resolve();
      });

      // Only the first call has reached the service; the second waits in the queue.
      expect(order).toEqual(['start:a']);

      // Resolve the first; the second should then fire.
      await act(async () => {
        resolvers[0]?.();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(order).toEqual(['start:a', 'end:a', 'start:a,b']);

      await act(async () => {
        resolvers[1]?.();
        await first;
        await second;
      });

      // Only one refresh (after the latest), not one per request.
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('useInitUserState', () => {
    const mockServerConfig = {
      defaultAgent: 'agent1',
      languageModel: 'model1',
      telemetry: {},
      aiProvider: {},
    } as GlobalServerConfig;

    it('should not fetch user state if user is not login', async () => {
      const mockUserConfig: any = undefined; // 模拟未初始化服务器的情况
      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserConfig);
      const successCallback = vi.fn();

      const { result } = renderHook(
        () =>
          useUserStore().useInitUserState(false, mockServerConfig, {
            onSuccess: successCallback,
          }),
        { wrapper: withSWR },
      );

      // 因为 initServer 为 false，所以不会触发 getUserState 的调用
      expect(userService.getUserState).not.toHaveBeenCalled();
      // 也不会触发 onSuccess 回调
      expect(successCallback).not.toHaveBeenCalled();
      // 确保状态未改变
      expect(result.current.data).toBeUndefined();
    });

    it('should fetch user state correctly when user is login', async () => {
      const mockUserState: UserInitializationState = {
        userId: 'user-id',
        isOnboard: true,
        onboarding: { finishedAt: '2024-01-01T00:00:00Z', version: 1 },
        preference: {
          telemetry: true,
        },
        settings: {
          general: { fontSize: 14, timezone: 'America/New_York' },
        },
        email: 'test@example.com',
      };

      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserState);
      const successCallback = vi.fn();

      const { result } = renderHook(
        () =>
          useUserStore().useInitUserState(true, mockServerConfig, {
            onSuccess: successCallback,
          }),
        {
          wrapper: withSWR,
        },
      );

      // 等待 SWR 完成数据获取
      await waitFor(() => expect(result.current.data).toEqual(mockUserState));

      // 验证状态是否正确更新
      expect(useUserStore.getState().user?.avatar).toBe(mockUserState.avatar);
      expect(userGeneralSettingsSelectors.config(useUserStore.getState() as any)).toEqual(
        expect.objectContaining({
          fontSize: 14,
          responseLanguage: expect.any(String),
          timezone: 'America/New_York',
        }),
      );
      expect(useUserStore.getState().user?.email).toEqual(mockUserState.email);
      expect(successCallback).toHaveBeenCalledWith(mockUserState);
    });

    it('should call switch language when language is auto', async () => {
      const mockUserState: UserInitializationState = {
        userId: 'user-id',
        isOnboard: true,
        preference: {
          telemetry: true,
        },
        settings: {},
      };

      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserState);

      const { result } = renderHook(() => useUserStore().useInitUserState(true, mockServerConfig), {
        wrapper: withSWR,
      });

      // 等待 SWR 完成数据获取
      await waitFor(() => expect(result.current.data).toEqual(mockUserState));
    });

    it('should fetch use server config correctly', async () => {
      const mockUserState: UserInitializationState = {
        userId: 'user-id',
        isOnboard: true,
        preference: {
          telemetry: true,
        },
        settings: {},
      };
      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserState);

      const { result } = renderHook(() => useUserStore().useInitUserState(true, mockServerConfig));

      await waitFor(() => expect(result.current.data).toEqual(mockUserState));
    });

    it('should return saved preference when local storage has data', async () => {
      const { result } = renderHook(() => useUserStore());

      const savedPreference: UserPreference = {
        ...DEFAULT_PREFERENCE,
        hideSyncAlert: true,
        guide: { topic: false, moveSettingsToAvatar: true },
      };

      const mockUserState: UserInitializationState = {
        userId: 'user-id',
        isOnboard: true,
        preference: savedPreference,
        settings: {
          general: { fontSize: 14 },
        },
      };
      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserState);

      const { result: preference } = renderHook(
        () => result.current.useInitUserState(true, mockServerConfig),
        { wrapper: withSWR },
      );

      await waitFor(() => {
        expect(preference.current.data?.preference).toEqual(savedPreference);
        expect(result.current.isUserStateInit).toBeTruthy();
        expect(result.current.preference).toEqual(savedPreference);
      });
    });

    it('should handle the case when user state have avatar', async () => {
      const { result } = renderHook(() => useUserStore());
      const mockUserState: UserInitializationState = {
        userId: 'user-id',
        isOnboard: true,
        onboarding: { finishedAt: '2024-01-01T00:00:00Z', version: 1 },
        preference: undefined as any,
        settings: null as any,
        avatar: 'abc',
      };

      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserState);

      renderHook(() => result.current.useInitUserState(true, mockServerConfig), {
        wrapper: withSWR,
      });

      //   等待 SWR 完成数据获取
      await waitFor(() => {
        expect(result.current.isUserStateInit).toBeTruthy();
        // 验证状态未被错误更新
        expect(result.current.user?.avatar).toEqual('abc');
        // When settings is null, auto-detect general settings will set them
        expect(result.current.settings).toEqual({
          general: { responseLanguage: expect.any(String), timezone: expect.any(String) },
        });
      });
    });

    it('should NOT auto-fill responseLanguage while onboarding is unfinished', async () => {
      const { result } = renderHook(() => useUserStore());

      const mockUserState: UserInitializationState = {
        userId: 'user-id',
        isOnboard: false,
        // No onboarding.finishedAt and no agentOnboarding.finishedAt:
        // user is still in the shared-prefix flow.
        preference: {} as any,
        settings: { general: { fontSize: 14 } },
      };
      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserState);

      renderHook(() => result.current.useInitUserState(true, mockServerConfig), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.isUserStateInit).toBeTruthy();
        expect(result.current.settings.general?.responseLanguage).toBeUndefined();
      });
    });

    it('should return default preference when local storage is empty', async () => {
      const { result } = renderHook(() => useUserStore());

      const mockUserState: UserInitializationState = {
        userId: 'user-id',
        isOnboard: true,
        preference: {} as any,
        settings: {
          general: { fontSize: 12 },
        },
      };

      vi.spyOn(userService, 'getUserState').mockResolvedValueOnce(mockUserState);

      renderHook(() => result.current.useInitUserState(true, mockServerConfig), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.isUserStateInit).toBeTruthy();
        expect(result.current.preference).toEqual(DEFAULT_PREFERENCE);
      });
    });
  });

  describe('useCheckTrace', () => {
    it('should return undefined when shouldFetch is false', async () => {
      const { result } = renderHook(() => useUserStore().useCheckTrace(false), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toBeUndefined());
    });

    it('should return false when telemetry is already set', async () => {
      vi.spyOn(userGeneralSettingsSelectors, 'telemetry').mockReturnValueOnce(true);

      const { result } = renderHook(() => useUserStore().useCheckTrace(true), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toBe(false));
    });

    it('should call messageService.messageCountToCheckTrace when needed', async () => {
      vi.spyOn(userGeneralSettingsSelectors, 'telemetry').mockReturnValueOnce(undefined as any);

      act(() => {
        useUserStore.setState({
          isUserCanEnableTrace: true,
        });
      });

      const { result } = renderHook(() => useUserStore.getState().useCheckTrace(true), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toBe(true));
    });
  });
});
