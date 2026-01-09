import { ElectronAppState, ThemeMode } from '@lobechat/electron-client-ipc';
import { app, desktopCapturer, dialog, nativeTheme, shell, systemPreferences } from 'electron';
import { macOS } from 'electron-is';
import process from 'node:process';

import { checkFullDiskAccess, openFullDiskAccessSettings } from '@/utils/fullDiskAccess';
import { createLogger } from '@/utils/logger';

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
    if (!macOS()) {
      logger.info('[Accessibility] Not macOS, returning true');
      return true;
    }
    logger.info('[Accessibility] Requesting accessibility access (will prompt if not granted)...');
    // Pass true to prompt user if not already trusted
    const result = systemPreferences.isTrustedAccessibilityClient(true);
    logger.info(`[Accessibility] isTrustedAccessibilityClient(true) returned: ${result}`);
    return result;
  }

  @IpcMethod()
  getAccessibilityStatus() {
    if (!macOS()) {
      logger.info('[Accessibility] Not macOS, returning true');
      return true;
    }
    // Pass false to just check without prompting
    const status = systemPreferences.isTrustedAccessibilityClient(false);
    logger.info(`[Accessibility] Current status: ${status}`);
    return status;
  }

  /**
   * Check if Full Disk Access is granted.
   * This works by attempting to read a protected system directory.
   * Calling this also registers the app in the TCC database, making it appear
   * in System Settings > Privacy & Security > Full Disk Access.
   */
  @IpcMethod()
  getFullDiskAccessStatus(): boolean {
    return checkFullDiskAccess();
  }

  /**
   * Prompt the user with a native dialog if Full Disk Access is not granted.
   * Based on https://github.com/inket/FullDiskAccess
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
    if (checkFullDiskAccess()) {
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
    if (!macOS()) return 'granted';
    return systemPreferences.getMediaAccessStatus(mediaType);
  }

  @IpcMethod()
  async requestMicrophoneAccess(): Promise<boolean> {
    if (!macOS()) {
      logger.info('[Microphone] Not macOS, returning true');
      return true;
    }

    const status = systemPreferences.getMediaAccessStatus('microphone');
    logger.info(`[Microphone] Current status: ${status}`);

    // Only ask for access if status is 'not-determined'
    // If already denied/restricted, the system won't show a prompt
    if (status === 'not-determined') {
      logger.info('[Microphone] Status is not-determined, calling askForMediaAccess...');
      try {
        const result = await systemPreferences.askForMediaAccess('microphone');
        logger.info(`[Microphone] askForMediaAccess result: ${result}`);
        return result;
      } catch (error) {
        logger.error('[Microphone] askForMediaAccess failed:', error);
        return false;
      }
    }

    if (status === 'granted') {
      logger.info('[Microphone] Already granted');
      return true;
    }

    // If denied or restricted, open System Settings for manual enable
    logger.info(`[Microphone] Status is ${status}, opening System Settings...`);
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    );

    return false;
  }

  @IpcMethod()
  async requestScreenAccess(): Promise<boolean> {
    if (!macOS()) {
      logger.info('[Screen] Not macOS, returning true');
      return true;
    }

    const status = systemPreferences.getMediaAccessStatus('screen');
    logger.info(`[Screen] Current status: ${status}`);

    // If already granted, no need to do anything
    if (status === 'granted') {
      logger.info('[Screen] Already granted');
      return true;
    }

    // IMPORTANT:
    // On macOS, the app may NOT appear in "Screen Recording" list until it actually
    // requests the permission once (TCC needs to register this app).
    // We use multiple approaches to ensure TCC registration:
    // 1. desktopCapturer.getSources() in main process
    // 2. getDisplayMedia() in renderer as fallback

    // Approach 1: Use desktopCapturer in main process
    logger.info('[Screen] Attempting TCC registration via desktopCapturer.getSources...');
    try {
      // Using a reasonable thumbnail size and both types to ensure TCC registration
      const sources = await desktopCapturer.getSources({
        fetchWindowIcons: true,
        thumbnailSize: { height: 144, width: 256 },
        types: ['screen', 'window'],
      });
      // Access the sources to ensure the capture actually happens
      logger.info(`[Screen] desktopCapturer.getSources returned ${sources.length} sources`);
    } catch (error) {
      logger.warn('[Screen] desktopCapturer.getSources failed:', error);
    }

    // Approach 2: Trigger getDisplayMedia in renderer as additional attempt
    // This shows the OS capture picker which definitely registers with TCC
    logger.info('[Screen] Attempting TCC registration via getDisplayMedia in renderer...');
    try {
      const mainWindow = this.app.browserManager.getMainWindow()?.browserWindow;
      if (mainWindow && !mainWindow.isDestroyed()) {
        const script = `
(async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    console.error('[Screen] getDisplayMedia error:', e);
    return false;
  }
})()
        `.trim();

        const result = await mainWindow.webContents.executeJavaScript(script, true);
        logger.info(`[Screen] getDisplayMedia result: ${result}`);
      } else {
        logger.warn('[Screen] Main window not available for getDisplayMedia');
      }
    } catch (error) {
      logger.warn('[Screen] getDisplayMedia failed:', error);
    }

    // Check status after attempts
    const newStatus = systemPreferences.getMediaAccessStatus('screen');
    logger.info(`[Screen] Status after TCC attempts: ${newStatus}`);

    // Open System Settings for user to manually enable screen recording
    logger.info('[Screen] Opening System Settings for Screen Recording...');
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );

    const finalStatus = systemPreferences.getMediaAccessStatus('screen');
    logger.info(`[Screen] Final status: ${finalStatus}`);
    return finalStatus === 'granted';
  }

  /**
   * Open Full Disk Access settings page
   */
  @IpcMethod()
  async openFullDiskAccessSettings() {
    return openFullDiskAccessSettings();
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
