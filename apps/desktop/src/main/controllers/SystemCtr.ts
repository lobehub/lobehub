import process from 'node:process';

import type { ElectronAppState, ThemeMode } from '@lobechat/electron-client-ipc';
import { app, dialog, nativeTheme, shell } from 'electron';
import { macOS } from 'electron-is';
import { pathExists, readdir } from 'fs-extra';

import { legacyLocalDbDir } from '@/const/dir';
import { createLogger } from '@/utils/logger';
import {
  getAccessibilityStatus,
  getFullDiskAccessStatus,
  getMediaAccessStatus,
  openFullDiskAccessSettings,
  requestAccessibilityAccess,
  requestMicrophoneAccess,
  requestScreenCaptureAccess,
} from '@/utils/permissions';

import { ControllerModule, IpcMethod } from './index';

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
    return requestAccessibilityAccess();
  }

  @IpcMethod()
  getAccessibilityStatus() {
    const status = getAccessibilityStatus();
    return status === 'granted';
  }

  @IpcMethod()
  getFullDiskAccessStatus(): boolean {
    const status = getFullDiskAccessStatus();
    return status === 'granted';
  }

  /**
   * Prompt the user with a native dialog if Full Disk Access is not granted.
   *
   * @param options - Dialog options
   * @returns 'granted' if already granted, 'opened_settings' if user chose to open settings,
   *          'skipped' if user chose to skip, 'cancelled' if dialog was cancelled
   */
  @IpcMethod()
  async promptFullDiskAccessIfNotGranted(options?: {
    message?: string;
    openSettingsButtonText?: string;
    skipButtonText?: string;
    title?: string;
  }): Promise<'cancelled' | 'granted' | 'opened_settings' | 'skipped'> {
    // Check if already granted
    const status = getFullDiskAccessStatus();
    if (status === 'granted') {
      logger.info('[FullDiskAccess] Already granted, skipping prompt');
      return 'granted';
    }

    if (!macOS()) {
      logger.info('[FullDiskAccess] Not macOS, returning granted');
      return 'granted';
    }

    const mainWindow = this.app.browserManager.getMainWindow()?.browserWindow;

    // Get localized strings
    const t = this.app.i18n.ns('dialog');
    const title = options?.title || t('fullDiskAccess.title');
    const message = options?.message || t('fullDiskAccess.message');
    const openSettingsButtonText =
      options?.openSettingsButtonText || t('fullDiskAccess.openSettings');
    const skipButtonText = options?.skipButtonText || t('fullDiskAccess.skip');

    logger.info('[FullDiskAccess] Showing native prompt dialog');

    const result = await dialog.showMessageBox(mainWindow!, {
      buttons: [openSettingsButtonText, skipButtonText],
      cancelId: 1,
      defaultId: 0,
      message: message,
      title: title,
      type: 'info',
    });

    if (result.response === 0) {
      // User chose to open settings
      logger.info('[FullDiskAccess] User chose to open settings');
      await this.openFullDiskAccessSettings();
      return 'opened_settings';
    } else {
      // User chose to skip or cancelled
      logger.info('[FullDiskAccess] User chose to skip');
      return 'skipped';
    }
  }

  @IpcMethod()
  async getMediaAccessStatus(mediaType: 'microphone' | 'screen'): Promise<string> {
    return getMediaAccessStatus(mediaType);
  }

  @IpcMethod()
  async requestMicrophoneAccess(): Promise<boolean> {
    return requestMicrophoneAccess();
  }

  @IpcMethod()
  async requestScreenAccess(): Promise<boolean> {
    return requestScreenCaptureAccess();
  }

  @IpcMethod()
  async openFullDiskAccessSettings() {
    return openFullDiskAccessSettings();
  }

  @IpcMethod()
  openExternalLink(url: string) {
    return shell.openExternal(url);
  }

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

  @IpcMethod()
  getSystemLocale(): string {
    return app.getLocale();
  }

  @IpcMethod()
  async updateLocale(locale: string) {
    this.app.storeManager.set('locale', locale);

    await this.app.i18n.changeLanguage(locale === 'auto' ? app.getLocale() : locale);
    this.app.browserManager.broadcastToAllWindows('localeChanged', { locale });

    return { success: true };
  }

  @IpcMethod()
  async updateThemeModeHandler(themeMode: ThemeMode) {
    this.app.storeManager.set('themeMode', themeMode);
    this.app.browserManager.broadcastToAllWindows('themeChanged', { themeMode });
    this.setSystemThemeMode(themeMode);
    this.app.browserManager.handleAppThemeChange();
  }

  @IpcMethod()
  async getSystemThemeMode() {
    return nativeTheme.themeSource;
  }

  /**
   * Detect whether user used the legacy local database in older desktop versions.
   * Legacy path: {app.getPath('userData')}/lobehub-storage/lobehub-local-db
   */
  @IpcMethod()
  async hasLegacyLocalDb(): Promise<boolean> {
    if (!(await pathExists(legacyLocalDbDir))) return false;

    try {
      const entries = await readdir(legacyLocalDbDir);
      return entries.length > 0;
    } catch {
      // If directory exists but cannot be read, treat as "used" to surface guidance.
      return true;
    }
  }

  private async setSystemThemeMode(themeMode: ThemeMode) {
    nativeTheme.themeSource = themeMode;
  }

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
