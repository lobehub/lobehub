import type * as GuideAddonModule from '@lobechat/electron-mac-permission-guide';
import type { ScreenCaptureStatus } from '@lobechat/electron-mac-permission-guide';
import type * as ScreenCaptureAddonModule from '@lobechat/electron-mac-screen-capture';
import { shell } from 'electron';
import * as macPermissions from 'node-mac-permissions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetMacPermissionsModuleCache,
  __setGuideAddonModule,
  __setMacPermissionsModule,
  __setScreenCaptureModule,
  getMediaAccessStatus,
  getScreenCaptureStatus,
  isScreenCaptureUsable,
  requestScreenCaptureAccess,
} from '../permissions';

// This suite drives the macOS branches from any host; node-mac-permissions and
// electron themselves are stubbed in the shared setup file.
vi.mock('@/utils/platform', () => ({ macOS: vi.fn(() => true) }));

type GuideAddon = typeof GuideAddonModule;
type ScreenCaptureAddon = typeof ScreenCaptureAddonModule;

// The addon module type also declares the guide surface; only the two Screen
// Recording queries are exercised here.
const makeAddon = (
  status: ScreenCaptureStatus | null,
  titlesReadable: boolean | null = false,
): GuideAddon =>
  ({
    canReadOtherAppWindowTitles: vi.fn(() => titlesReadable),
    screenCaptureStatus: vi.fn(() => status),
  }) as unknown as GuideAddon;

// Only the two capture-side queries are exercised here as well.
const makeCaptureAddon = (
  supported: boolean,
  permission: ScreenCaptureStatus = 'granted',
): ScreenCaptureAddon =>
  ({
    isSupported: vi.fn(() => supported),
    probeCapturePermission: vi.fn(() => permission),
  }) as unknown as ScreenCaptureAddon;

describe('permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // node-mac-permissions is only reachable through a lazily cached require, so
    // the module must be injected rather than mocked by specifier.
    __resetMacPermissionsModuleCache();
    __setMacPermissionsModule(macPermissions);
    // What CGPreflightScreenCaptureAccess keeps returning for the whole process
    // lifetime once it has seen a denial — the value that used to make a grant
    // invisible until the app was relaunched.
    vi.mocked(macPermissions.getAuthStatus).mockReturnValue('denied');
    // `null`s are what the addons report on platforms or builds without them.
    __setGuideAddonModule(makeAddon(null, null));
    __setScreenCaptureModule(makeCaptureAddon(false));
  });

  describe('getScreenCaptureStatus', () => {
    it('reports the grant tccd has now instead of the cached preflight answer', () => {
      __setGuideAddonModule(makeAddon('granted'));

      expect(getScreenCaptureStatus()).toBe('granted');
    });

    it('maps an inconclusive native answer to not-determined', () => {
      __setGuideAddonModule(makeAddon('unknown'));

      expect(getScreenCaptureStatus()).toBe('not-determined');
    });

    it('falls back to node-mac-permissions without the native guide', () => {
      vi.mocked(macPermissions.getAuthStatus).mockReturnValue('not determined');

      expect(getScreenCaptureStatus()).toBe('not-determined');
    });
  });

  describe('getMediaAccessStatus', () => {
    it("reports the live Screen Recording answer in Electron's format", () => {
      __setGuideAddonModule(makeAddon('granted'));
      expect(getMediaAccessStatus('screen')).toBe('granted');

      __setGuideAddonModule(makeAddon('denied'));
      expect(getMediaAccessStatus('screen')).toBe('denied');
    });
  });

  describe('isScreenCaptureUsable', () => {
    it('asks ScreenCaptureKit when the capture path can use it', () => {
      __setGuideAddonModule(makeAddon('granted', true));
      __setScreenCaptureModule(makeCaptureAddon(true, 'granted'));
      expect(isScreenCaptureUsable()).toBe(true);

      // ScreenCaptureKit declining wins over the readable titles: it is the API
      // the capture itself goes through.
      __setScreenCaptureModule(makeCaptureAddon(true, 'denied'));
      expect(isScreenCaptureUsable()).toBe(false);
    });

    it('falls back to the window-title probe below macOS 14', () => {
      __setGuideAddonModule(makeAddon('granted', true));
      __setScreenCaptureModule(makeCaptureAddon(false));

      expect(isScreenCaptureUsable()).toBe(true);

      __setGuideAddonModule(makeAddon('granted', false));
      expect(isScreenCaptureUsable()).toBe(false);
    });

    it('is not usable while the grant is missing', () => {
      __setGuideAddonModule(makeAddon('denied', true));
      __setScreenCaptureModule(makeCaptureAddon(true, 'granted'));

      expect(isScreenCaptureUsable()).toBe(false);
    });

    it('does not demand a relaunch when no probe is available', () => {
      // A build without either addon reports nulls, not denials.
      __setGuideAddonModule(makeAddon('granted', null));
      __setScreenCaptureModule(makeCaptureAddon(false));

      expect(isScreenCaptureUsable()).toBe(true);
    });
  });

  describe('requestScreenCaptureAccess', () => {
    it('opens the pane instead of raising the system request alert', async () => {
      await expect(requestScreenCaptureAccess()).resolves.toBe(false);

      expect(macPermissions.askForScreenCaptureAccess).not.toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    });

    it('reports a grant that lands while the app is running', async () => {
      __setGuideAddonModule(makeAddon('denied'));

      const pending = requestScreenCaptureAccess();
      __setGuideAddonModule(makeAddon('granted'));

      await expect(pending).resolves.toBe(true);
    });

    it('leaves System Settings alone when the permission is already on', async () => {
      __setGuideAddonModule(makeAddon('granted'));

      await expect(requestScreenCaptureAccess()).resolves.toBe(true);

      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });
});
