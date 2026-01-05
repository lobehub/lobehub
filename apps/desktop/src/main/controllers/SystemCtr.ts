import { ElectronAppState, ThemeMode } from '@lobechat/electron-client-ipc';
import { app, dialog, nativeTheme, shell, systemPreferences } from 'electron';
import { macOS } from 'electron-is';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import fullDiskAccessAutoAddScript from './scripts/full-disk-access.applescript?raw';

const logger = createLogger('controllers:SystemCtr');

export default class SystemController extends ControllerModule {
  static override readonly groupName = 'system';
  private systemThemeListenerInitialized = false;

  /**
   * Initialize system theme listener when app is ready
   */
  afterAppReady() {
    this.initializeSystemThemeListener();
  }

  /**
   * Handles the 'getDesktopAppState' IPC request.
   * Gathers essential application and system information.
   */
  @IpcMethod()
  async getAppState(): Promise<ElectronAppState> {
    const platform = process.platform;
    const arch = process.arch;

    return {
      // System Info
      arch,
      isLinux: platform === 'linux',
      isMac: platform === 'darwin',
      isWindows: platform === 'win32',
      locale: this.app.storeManager.get('locale', 'auto'),

      platform: platform as 'darwin' | 'win32' | 'linux',
      userPath: {
        // User Paths (ensure keys match UserPathData / DesktopAppState interface)
        desktop: app.getPath('desktop'),
        documents: app.getPath('documents'),
        downloads: app.getPath('downloads'),
        home: app.getPath('home'),
        music: app.getPath('music'),
        pictures: app.getPath('pictures'),
        userData: app.getPath('userData'),
        videos: app.getPath('videos'),
      },
    };
  }

  @IpcMethod()
  requestAccessibilityAccess() {
    if (!macOS()) return true;
    return systemPreferences.isTrustedAccessibilityClient(true);
  }

  @IpcMethod()
  getAccessibilityStatus() {
    if (!macOS()) return true;
    return systemPreferences.isTrustedAccessibilityClient(false);
  }

  @IpcMethod()
  async getMediaAccessStatus(mediaType: 'microphone' | 'screen'): Promise<string> {
    if (!macOS()) return 'granted';
    return systemPreferences.getMediaAccessStatus(mediaType);
  }

  @IpcMethod()
  async requestMicrophoneAccess(): Promise<boolean> {
    if (!macOS()) return true;
    return systemPreferences.askForMediaAccess('microphone');
  }

  @IpcMethod()
  async requestScreenAccess(): Promise<boolean> {
    if (!macOS()) return true;

    // IMPORTANT:
    // On macOS, the app may NOT appear in "Screen Recording" list until it actually
    // requests the permission once (TCC needs to register this app).
    // So we try to proactively request it first, then open System Settings for manual toggle.
    // 1) Best-effort: try Electron runtime API if available (not typed in Electron 38).
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status !== 'granted') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await (systemPreferences as any).askForMediaAccess?.('screen');
      }
    } catch (error) {
      logger.warn('Failed to request screen recording access via systemPreferences', error);
    }

    // 2) Reliable trigger: run a one-shot getDisplayMedia in renderer to register TCC entry.
    // This will show the OS capture picker; once the user selects/cancels, we stop tracks immediately.
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status !== 'granted') {
        const mainWindow = this.app.browserManager.getMainWindow()?.browserWindow;
        if (mainWindow && !mainWindow.isDestroyed()) {
          const script = `
(() => {
  const stop = (stream) => {
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
  };
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    .then((stream) => { stop(stream); return true; })
    .catch(() => false);
})()
          `.trim();

          await mainWindow.webContents.executeJavaScript(script, true);
        }
      }
    } catch (error) {
      logger.warn('Failed to request screen recording access via getDisplayMedia', error);
    }

    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );

    return systemPreferences.getMediaAccessStatus('screen') === 'granted';
  }

  @IpcMethod()
  openFullDiskAccessSettings(payload?: { autoAdd?: boolean }) {
    if (!macOS()) return;
    const { autoAdd = false } = payload || {};

    // NOTE:
    // - Full Disk Access cannot be requested programmatically like microphone/screen.
    // - On macOS 13+ (Ventura), System Preferences is replaced by System Settings,
    //   and deep links may differ. We try multiple known schemes for compatibility.
    const candidates = [
      // macOS 13+ (System Settings)
      'com.apple.settings:Privacy&path=FullDiskAccess',
      // Older macOS (System Preferences)
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    ];
    if (autoAdd) this.tryAutoAddFullDiskAccess();

    (async () => {
      for (const url of candidates) {
        try {
          await shell.openExternal(url);
          return;
        } catch (error) {
          logger.warn(`Failed to open Full Disk Access settings via ${url}`, error);
        }
      }
    })();
  }

  /**
   * Best-effort UI automation to add this app into Full Disk Access list.
   *
   * Limitations:
   * - This uses AppleScript UI scripting (System Events) and may require the user to grant
   *   additional "Automation" permission (to control System Settings).
   * - UI structure differs across macOS versions/languages; we fall back silently.
   */
  private tryAutoAddFullDiskAccess() {
    if (!macOS()) return;

    const exePath = app.getPath('exe');
    // /Applications/App.app/Contents/MacOS/App -> /Applications/App.app
    const appBundlePath = path.resolve(path.dirname(exePath), '..', '..');

    // Keep the script minimal and resilient; failure should not break onboarding flow.
    const script = fullDiskAccessAutoAddScript.trim();

    try {
      const child = spawn('osascript', ['-e', script, appBundlePath], { env: process.env });
      child.on('error', (error) => {
        logger.warn('Full Disk Access auto-add (osascript) failed to start', error);
      });
      child.on('exit', (code) => {
        logger.debug('Full Disk Access auto-add (osascript) exited', { code });
      });
    } catch (error) {
      logger.warn('Full Disk Access auto-add failed', error);
    }
  }

  @IpcMethod()
  openExternalLink(url: string) {
    return shell.openExternal(url);
  }

  /**
   * Open native folder picker dialog
   */
  @IpcMethod()
  async selectFolder(payload?: {
    defaultPath?: string;
    title?: string;
  }): Promise<string | undefined> {
    const mainWindow = this.app.browserManager.getMainWindow()?.browserWindow;

    const result = await dialog.showOpenDialog(mainWindow!, {
      defaultPath: payload?.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      title: payload?.title || 'Select Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    return result.filePaths[0];
  }

  /**
   * Get the OS system locale
   */
  @IpcMethod()
  getSystemLocale(): string {
    return app.getLocale();
  }

  /**
   * 更新应用语言设置
   */
  @IpcMethod()
  async updateLocale(locale: string) {
    // 保存语言设置
    this.app.storeManager.set('locale', locale);

    // 更新i18n实例的语言
    await this.app.i18n.changeLanguage(locale === 'auto' ? app.getLocale() : locale);
    this.app.browserManager.broadcastToAllWindows('localeChanged', { locale });

    return { success: true };
  }

  @IpcMethod()
  async updateThemeModeHandler(themeMode: ThemeMode) {
    this.app.storeManager.set('themeMode', themeMode);
    this.app.browserManager.broadcastToAllWindows('themeChanged', { themeMode });

    // Apply visual effects to all browser windows when theme mode changes
    this.app.browserManager.handleAppThemeChange();
    // Set app theme mode to the system theme mode

    this.setSystemThemeMode(themeMode);
  }

  @IpcMethod()
  async getSystemThemeMode() {
    return nativeTheme.themeSource;
  }

  private async setSystemThemeMode(themeMode: ThemeMode) {
    nativeTheme.themeSource = themeMode;
  }

  /**
   * Initialize system theme listener to monitor OS theme changes
   */
  private initializeSystemThemeListener() {
    if (this.systemThemeListenerInitialized) {
      logger.debug('System theme listener already initialized');
      return;
    }

    logger.info('Initializing system theme listener');

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
      const isDarkMode = nativeTheme.shouldUseDarkColors;
      const systemTheme: ThemeMode = isDarkMode ? 'dark' : 'light';

      logger.info(`System theme changed to: ${systemTheme}`);

      // Broadcast system theme change to all renderer processes
      this.app.browserManager.broadcastToAllWindows('systemThemeChanged', {
        themeMode: systemTheme,
      });
    });

    this.systemThemeListenerInitialized = true;
    logger.info('System theme listener initialized successfully');
  }
}
