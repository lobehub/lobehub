import { DEFAULT_SETTINGS } from '@lobechat/config';
import { DEFAULT_AGENT } from '@lobechat/const';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PartialDeep } from 'type-fest';
import { describe, expect, it, vi } from 'vitest';
import { withSWR } from '~test-utils';

import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { LobeAgentSettings } from '@/types/session';
import { UserSettings } from '@/types/user/settings';
import { merge } from '@/utils/merge';

vi.mock('zustand/traditional');

// Mock userService
vi.mock('@/services/user', () => ({
  userService: {
    updateUserSettings: vi.fn(),
    resetUserSettings: vi.fn(),
  },
}));

describe('SettingsAction', () => {
  describe('importAppSettings', () => {
    it('should import app settings', async () => {
      const { result } = renderHook(() => useUserStore());
      const newSettings: UserSettings = merge(DEFAULT_SETTINGS, {
        general: { themeMode: 'dark' },
      });

      // Mock the internal setSettings function call
      const setSettingsSpy = vi.spyOn(result.current, 'setSettings');

      // Perform the action
      await act(async () => {
        await result.current.importAppSettings(newSettings);
      });

      // Assert that setSettings was called with the correct settings
      expect(setSettingsSpy).toHaveBeenCalledWith(newSettings);

      // Assert that the state has been updated
      expect(userService.updateUserSettings).toHaveBeenCalledWith(
        { general: { themeMode: 'dark' } },
        expect.any(AbortSignal),
      );

      // Restore the spy
      setSettingsSpy.mockRestore();
    });
  });

  describe('resetSettings', () => {
    it('should reset settings to default', async () => {
      const { result } = renderHook(() => useUserStore());

      // Perform the action
      await act(async () => {
        await result.current.resetSettings();
      });

      // Assert that resetUserSettings was called
      expect(userService.resetUserSettings).toHaveBeenCalled();

      // Assert that the state has been updated to default settings
      expect(result.current.settings).toEqual({});
    });
  });

  describe('setSettings', () => {
    it('should set partial settings', async () => {
      const { result } = renderHook(() => useUserStore());
      const partialSettings: PartialDeep<UserSettings> = { general: { fontSize: 12 } };

      // Perform the action
      await act(async () => {
        await result.current.setSettings(partialSettings);
      });

      // Assert that updateUserSettings was called with the correct settings
      expect(userService.updateUserSettings).toHaveBeenCalledWith(
        partialSettings,
        expect.any(AbortSignal),
      );
    });
  });

  describe('updateDefaultAgent', () => {
    it('should update default agent settings', async () => {
      const { result } = renderHook(() => useUserStore());
      const updatedAgent: Partial<LobeAgentSettings> = {
        meta: { title: 'docs' },
      };

      // Perform the action
      await act(async () => {
        await result.current.updateDefaultAgent(updatedAgent);
      });

      // Assert that updateUserSettings was called with the merged agent settings
      expect(userService.updateUserSettings).toHaveBeenCalledWith(
        { defaultAgent: updatedAgent },
        expect.any(AbortSignal),
      );
    });
  });

  describe('updateSystemAgent', () => {
    it('should set partial settings', async () => {
      const { result } = renderHook(() => useUserStore());
      const systemAgentSettings: PartialDeep<UserSettings> = {
        systemAgent: {
          translation: {
            model: 'testmodel',
            provider: 'provider',
          },
        },
      };

      // Perform the action
      await act(async () => {
        await result.current.updateSystemAgent('translation', {
          provider: 'provider',
          model: 'testmodel',
        });
      });

      // Assert that updateUserSettings was called with the correct settings
      expect(userService.updateUserSettings).toHaveBeenCalledWith(
        systemAgentSettings,
        expect.any(AbortSignal),
      );
    });
  });
});
