import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { readUserDisplaySnapshot, writeUserDisplaySnapshot } from '@/store/user/displaySnapshot';
import { type UserGuide } from '@/types/user';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPreferenceSlice', () => {
  describe('updateGuideState', () => {
    it('should update guide state', () => {
      const { result } = renderHook(() => useUserStore());
      const guide: UserGuide = { topic: true };

      act(() => {
        result.current.updateGuideState(guide);
      });

      expect(result.current.preference.guide!.topic).toBeTruthy();
    });
  });

  describe('updatePreference', () => {
    it('should update preference', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        result.current.updatePreference({ hideSyncAlert: true });
      });

      expect(result.current.preference.hideSyncAlert).toEqual(true);
    });

    it('persists the preference after the server update succeeds', async () => {
      const updatePreferenceSpy = vi
        .spyOn(userService, 'updatePreference')
        .mockResolvedValue(undefined as any);

      act(() => {
        useUserStore.setState({ user: { avatar: 'avatar-a', id: 'user-a' } as any });
      });

      await act(async () => {
        await useUserStore.getState().updatePreference({
          lab: { enableProjects: true },
        });
      });

      expect(updatePreferenceSpy).toHaveBeenCalled();
      expect(readUserDisplaySnapshot('user-a')).toEqual({
        preference: expect.objectContaining({
          lab: expect.objectContaining({ enableProjects: true }),
        }),
      });
    });

    it('does not persist a failed preference update', async () => {
      vi.spyOn(userService, 'updatePreference').mockRejectedValue(new Error('update failed'));

      act(() => {
        useUserStore.setState({ user: { avatar: 'avatar-a', id: 'user-a' } as any });
      });

      await expect(
        useUserStore.getState().updatePreference({ lab: { enableProjects: true } }),
      ).rejects.toThrow('update failed');
      expect(readUserDisplaySnapshot('user-a')).toBeUndefined();
    });

    it('persists under the user id captured before an update can switch accounts', async () => {
      let resolveUpdate: (() => void) | undefined;
      const updatePreferenceSpy = vi.spyOn(userService, 'updatePreference').mockImplementation(
        () =>
          new Promise<Awaited<ReturnType<typeof userService.updatePreference>>>((resolve) => {
            resolveUpdate = () => resolve(undefined);
          }),
      );

      act(() => {
        useUserStore.setState({ user: { avatar: 'avatar-a', id: 'user-a' } });
      });

      let updatePromise: Promise<void> | undefined;
      act(() => {
        updatePromise = useUserStore.getState().updatePreference({ lab: { enableProjects: true } });
      });
      writeUserDisplaySnapshot('user-a', { avatar: 'updated-avatar' });

      act(() => {
        useUserStore.setState({ user: { avatar: 'avatar-b', id: 'user-b' } });
      });

      expect(resolveUpdate).toBeDefined();
      await act(async () => {
        resolveUpdate?.();
        await updatePromise;
      });

      expect(updatePreferenceSpy).toHaveBeenCalled();
      expect(readUserDisplaySnapshot('user-a')).toEqual({
        avatar: 'updated-avatar',
        preference: expect.objectContaining({
          lab: expect.objectContaining({ enableProjects: true }),
        }),
      });
      expect(readUserDisplaySnapshot('user-b')).toBeUndefined();
    });
  });
});
