import { DEFAULT_SETTINGS } from '@lobechat/config';
import { act, renderHook } from '@testing-library/react';
import type { PartialDeep } from 'type-fest';
import { describe, expect, it, vi } from 'vitest';

import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import type { LobeAgentSettings } from '@/types/session';
import type { UserSettings } from '@/types/user/settings';
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
    it('should import app settings without changing the current telemetry consent', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.updateGeneralConfig({ telemetry: true });
      });

      const newSettings: UserSettings = merge(DEFAULT_SETTINGS, {
        general: { telemetry: false, timezone: 'Asia/Shanghai' },
      });

      // Mock the internal setSettings function call
      const setSettingsSpy = vi.spyOn(result.current, 'setSettings');

      // Perform the action
      await act(async () => {
        await result.current.importAppSettings(newSettings);
      });

      const importedSettings = setSettingsSpy.mock.calls.at(-1)?.[0];
      expect(importedSettings?.general).not.toHaveProperty('telemetry');
      expect(importedSettings?.general?.timezone).toBe('Asia/Shanghai');
      expect(newSettings.general.telemetry).toBe(false);

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        { general: { telemetry: true, timezone: 'Asia/Shanghai' } },
        expect.any(AbortSignal),
      );

      // Restore the spy
      setSettingsSpy.mockRestore();
    });
  });

  describe('importUrlShareSettings', () => {
    it('should apply shared settings without enabling telemetry', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.updateGeneralConfig({ telemetry: false });
      });

      await act(async () => {
        await result.current.importUrlShareSettings(
          JSON.stringify({ general: { telemetry: true, timezone: 'Asia/Shanghai' } }),
        );
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        { general: { telemetry: false, timezone: 'Asia/Shanghai' } },
        expect.any(AbortSignal),
      );
    });

    it('should ignore invalid shared general settings without clearing telemetry consent', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.updateGeneralConfig({ telemetry: false });
      });

      await act(async () => {
        await result.current.importUrlShareSettings(
          JSON.stringify({ general: null, memory: { enabled: false } }),
        );
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        { general: { telemetry: false }, memory: { enabled: false } },
        expect.any(AbortSignal),
      );
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

    it('should include field in diffs when user resets it to default value', async () => {
      const { result } = renderHook(() => useUserStore());

      // First, set memory.enabled to false (non-default value)
      await act(async () => {
        await result.current.setSettings({ memory: { enabled: false } });
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ memory: { enabled: false } }),
        expect.any(AbortSignal),
      );

      // Then, reset memory.enabled back to true (default value)
      // This should still include memory in the diffs to override the previously saved value
      await act(async () => {
        await result.current.setSettings({ memory: { enabled: true } });
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ memory: { enabled: true } }),
        expect.any(AbortSignal),
      );
    });

    it('should persist an explicit telemetry denial even though false is the default', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.updateGeneralConfig({ telemetry: false });
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        { general: { telemetry: false } },
        expect.any(AbortSignal),
      );
    });

    it('should preserve an explicit telemetry denial during later general setting updates', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.updateGeneralConfig({ telemetry: false });
        await result.current.updateGeneralConfig({ fontSize: 12 });
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        { general: { fontSize: 12, telemetry: false } },
        expect.any(AbortSignal),
      );
    });

    it('should roll back a failed optimistic update so telemetry persistence can be retried', async () => {
      const { result } = renderHook(() => useUserStore());
      const saveError = new Error('save failed');
      const updateUserSettings = vi.mocked(userService.updateUserSettings);
      updateUserSettings.mockClear().mockRejectedValueOnce(saveError);

      let caughtError: unknown;
      await act(async () => {
        try {
          await result.current.updateGeneralConfig({ telemetry: true });
        } catch (error) {
          caughtError = error;
        }
      });

      expect(caughtError).toBe(saveError);
      expect(result.current.settings.general?.telemetry).toBeUndefined();
      expect(updateUserSettings).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.updateGeneralConfig({ telemetry: true });
      });

      expect(updateUserSettings).toHaveBeenCalledTimes(2);
      expect(updateUserSettings).toHaveBeenLastCalledWith(
        { general: { telemetry: true } },
        expect.any(AbortSignal),
      );
    });

    it('should keep legacy scalar system agent fields unchanged', async () => {
      const { result } = renderHook(() => useUserStore());
      const settingsWithLegacySystemAgent = {
        systemAgent: {
          enableAutoReply: true,
        },
      } as PartialDeep<UserSettings>;

      await act(async () => {
        await result.current.setSettings(settingsWithLegacySystemAgent);
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        settingsWithLegacySystemAgent,
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

    it('should persist default agent model and provider together', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.updateDefaultAgent({
          config: { model: 'claude-opus-4-6' },
        });
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        {
          defaultAgent: {
            config: {
              model: 'claude-opus-4-6',
              provider: DEFAULT_SETTINGS.defaultAgent.config.provider,
            },
          },
        },
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

    it('should persist system agent model and provider together when provider matches default', async () => {
      const { result } = renderHook(() => useUserStore());
      const model = 'ag/gemini-3.1-pro-high';
      const provider = DEFAULT_SETTINGS.systemAgent.translation.provider;

      await act(async () => {
        await result.current.updateSystemAgent('translation', { model, provider });
      });

      expect(userService.updateUserSettings).toHaveBeenLastCalledWith(
        {
          systemAgent: {
            translation: {
              model,
              provider,
            },
          },
        },
        expect.any(AbortSignal),
      );
    });
  });
});
