import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';

import type {
  DebugLoggingDuration,
  DebugLoggingSettings,
  DiagnosticsBundleResult,
  ElectronAppState,
  RemoteDebuggingSettings,
  ThemeMode,
} from '@lobechat/electron-client-ipc';
import { app, dialog, nativeTheme, shell } from 'electron';

import { legacyLocalDbDir } from '@/const/dir';
import { setDebugLogging } from '@/modules/debugLogging';
import { writeDiagnosticsBundle } from '@/modules/diagnostics/bundle';
import { getRemoteDebuggingLaunchState, REMOTE_DEBUGGING_PORT } from '@/modules/remoteDebugging';
import { BUILD_CHANNEL } from '@/modules/updater/configs';
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
import * as electronIs from '@/utils/platform';
import { flushStructuredLogs, getStructuredLogDirectory } from '@/utils/structuredLog';
import { getSystemLanguage, resolveUILocale } from '@/utils/system-language';
import { safeGetPath } from '@/utils/user-path';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:SystemCtr');

interface SystemFont {
  label: string;
  value: string;
}

export default class SystemController extends ControllerModule {
  static override readonly groupName = 'system';
  private systemFontsPromises = new Map<string, Promise<SystemFont[]>>();
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
    const { getShellInfo } = await import('@lobechat/local-file-shell/shell');
    const platform = process.platform;
    const arch = process.arch;

    return {
      // System Info
      arch,
      // Tell the model which shell runCommand actually spawns (see local-file-shell).
      defaultShell: (await getShellInfo()).displayName,
      isLinux: platform === 'linux',
      isMac: platform === 'darwin',
      isWindows: platform === 'win32',
      locale: this.app.storeManager.get('locale', 'auto'),

      platform: platform as 'darwin' | 'win32' | 'linux',
      userPath: {
        // User Paths (ensure keys match UserPathData / DesktopAppState interface)
        desktop: app.getPath('desktop'),
        documents: app.getPath('documents'),
        downloads: safeGetPath('downloads'),
        home: app.getPath('home'),
        music: safeGetPath('music'),
        pictures: safeGetPath('pictures'),
        userData: app.getPath('userData'),
        videos: safeGetPath('videos'),
      },
    };
  }

  @IpcMethod()
  setDesktopOnboardingCompleted(completed: boolean): void {
    this.app.storeManager.set('desktopOnboardingCompleted', completed);
  }

  @IpcMethod()
  setLastWorkspaceSlug(slug: string | null): void {
    const { userId } = this.app.getController(RemoteServerConfigCtr).getDesktopBootstrapIdentity();
    if (!userId) return;

    const slugByAccount = { ...this.app.storeManager.get('lastWorkspaceSlugByAccount', {}) };
    if (slug) slugByAccount[userId] = slug;
    else delete slugByAccount[userId];

    this.app.storeManager.set('lastWorkspaceSlugByAccount', slugByAccount);
  }

  @IpcMethod()
  async requestAccessibilityAccess(): Promise<boolean> {
    if (await this.app.permissionGuide.open('accessibility')) {
      return getAccessibilityStatus() === 'granted';
    }
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

    if (!electronIs.macOS()) {
      logger.info('[FullDiskAccess] Not macOS, returning granted');
      return 'granted';
    }

    if (await this.app.permissionGuide.open('fullDisk')) return 'opened_settings';

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
      message,
      title,
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
    if (await this.app.permissionGuide.open('screen')) {
      return getMediaAccessStatus('screen') === 'granted';
    }
    return requestScreenCaptureAccess();
  }

  @IpcMethod()
  async openFullDiskAccessSettings() {
    if (await this.app.permissionGuide.open('fullDisk')) return;
    return openFullDiskAccessSettings();
  }

  /**
   * Settings → About → Debug logs. `alwaysOn` is true in dev, which records
   * `debug` regardless of the setting.
   */
  @IpcMethod()
  getDebugLoggingSettings(): DebugLoggingSettings {
    const enabled = this.app.storeManager.get('debugLoggingEnabled', false);
    const expiresAt = enabled ? this.app.storeManager.get('debugLoggingExpiresAt') : undefined;
    return {
      alwaysOn: !app.isPackaged,
      enabled,
      ...(expiresAt === undefined ? undefined : { expiresAt }),
    };
  }

  /** Turns debug logging off, or on for a duration; a timed one turns itself off quietly. */
  @IpcMethod()
  setDebugLogging(duration: DebugLoggingDuration | 'off'): DebugLoggingSettings {
    setDebugLogging(this.app.storeManager, duration);
    logger.info(`Debug logging set to ${duration}`);
    return this.getDebugLoggingSettings();
  }

  @IpcMethod()
  getRemoteDebuggingSettings(): RemoteDebuggingSettings {
    return {
      ...getRemoteDebuggingLaunchState(),
      enabled: this.app.storeManager.get('remoteDebuggingEnabled', false),
      port: REMOTE_DEBUGGING_PORT,
    };
  }

  /** Persists the toggle; Chromium reads the CDP switch only at startup, so it applies on restart. */
  @IpcMethod()
  setRemoteDebuggingEnabled(enabled: boolean): RemoteDebuggingSettings {
    this.app.storeManager.set('remoteDebuggingEnabled', enabled);
    logger.info(`Remote debugging ${enabled ? 'enabled' : 'disabled'} for the next launch`);
    return this.getRemoteDebuggingSettings();
  }

  /** Reveals `<userData>/logs/` so a user can attach the files to a bug report. */
  @IpcMethod()
  async openLogDirectory(): Promise<void> {
    const directory = getStructuredLogDirectory();
    if (!directory) return;
    const error = await shell.openPath(directory);
    if (error) logger.warn(`Failed to open log directory: ${error}`);
  }

  /**
   * Writes a zip of the last day of logs plus app and system details to Downloads
   * (the log directory when Downloads is unavailable) and selects it in the file
   * manager, so a user can attach one file to a report.
   */
  @IpcMethod()
  async exportDiagnostics(): Promise<DiagnosticsBundleResult> {
    const logDirectory = getStructuredLogDirectory();
    if (!logDirectory) throw new Error('Structured logs are not open');
    // Queued lines would otherwise miss the bundle, including the click that made it.
    await flushStructuredLogs();

    const options = { logDirectory, now: new Date(), systemInfo: this.getDiagnosticsSystemInfo() };
    const downloads = safeGetPath('downloads');
    let result: DiagnosticsBundleResult | undefined;
    if (downloads) {
      // Downloads can resolve yet be missing or unwritable (redirected, sandboxed, removed).
      result = await writeDiagnosticsBundle({ ...options, outputDirectory: downloads }).catch(
        (error) => {
          logger.warn('Diagnostics could not be written to Downloads; using the log folder', error);
          return undefined;
        },
      );
    }
    result ??= await writeDiagnosticsBundle({ ...options, outputDirectory: logDirectory });
    shell.showItemInFolder(result.filePath);
    logger.info(`Diagnostics exported: ${result.fileName} (${result.size} bytes)`);
    return result;
  }

  /** `system.json` in the diagnostics zip; no host name, account or user content. */
  private getDiagnosticsSystemInfo() {
    const cpus = os.cpus();
    return {
      app: {
        buildChannel: BUILD_CHANNEL,
        isPackaged: app.isPackaged,
        locale: app.getLocale(),
        updateChannel: this.app.storeManager.get('updateChannel'),
        version: app.getVersion(),
      },
      debugLogging: this.getDebugLoggingSettings(),
      os: {
        arch: process.arch,
        cpu: cpus[0]?.model,
        cpuCount: cpus.length,
        freeMemory: os.freemem(),
        platform: process.platform,
        release: os.release(),
        totalMemory: os.totalmem(),
        uptimeSeconds: Math.round(os.uptime()),
        version: os.version(),
      },
      remoteDebugging: this.getRemoteDebuggingSettings(),
      runtime: {
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
      },
    };
  }

  @IpcMethod()
  openExternalLink(url: string) {
    return shell.openExternal(url);
  }

  @IpcMethod()
  async selectFolder(payload?: {
    defaultPath?: string;
    title?: string;
  }): Promise<{ path: string; repoType?: 'git' | 'github' } | undefined> {
    const mainWindow = this.app.browserManager.getMainWindow()?.browserWindow;

    const result = await dialog.showOpenDialog(mainWindow!, {
      defaultPath: payload?.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      title: payload?.title || 'Select Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    const folderPath = result.filePaths[0];
    const { detectRepoType } = await import('@lobechat/local-file-shell/git');
    const repoType = await detectRepoType(folderPath);

    try {
      const approvedRoot = await this.app.localFileProtocolManager.approveWorkspaceRoot(folderPath);

      if (approvedRoot) {
        const storedRoots = this.app.storeManager.get('localFileWorkspaceRoots', []);
        if (!storedRoots.includes(approvedRoot)) {
          this.app.storeManager.set('localFileWorkspaceRoots', [approvedRoot, ...storedRoots]);
        }
      }
    } catch (error) {
      logger.error(`Failed to approve local file workspace root ${folderPath}:`, error);
    }

    return { path: folderPath, repoType };
  }

  @IpcMethod()
  getSystemLocale(): string {
    return getSystemLanguage();
  }

  @IpcMethod()
  async getSystemMonospaceFonts(): Promise<SystemFont[]> {
    return this.loadSystemFonts(true);
  }

  @IpcMethod()
  async getSystemFonts(): Promise<SystemFont[]> {
    return this.loadSystemFonts(false);
  }

  private loadSystemFonts(monospaceOnly: boolean): Promise<SystemFont[]> {
    const cacheKey = monospaceOnly ? 'monospace' : 'all';
    let cached = this.systemFontsPromises.get(cacheKey);
    if (cached) return cached;

    cached = import('font-list')
      .then(({ getFonts2 }) => getFonts2())
      .then((fonts) => {
        const families = new Map<string, SystemFont>();

        for (const font of fonts) {
          const label = font.name.trim();
          const value = font.familyName.trim();
          if (!label || !value) continue;
          if (monospaceOnly && !font.monospace) continue;

          const normalizedName = label.toLocaleLowerCase();
          if (!families.has(normalizedName)) families.set(normalizedName, { label, value });
        }

        return [...families.values()].sort((left, right) => left.label.localeCompare(right.label));
      })
      .catch((error) => {
        this.systemFontsPromises.delete(cacheKey);
        logger.error('Failed to enumerate system fonts:', error);
        throw error;
      });

    this.systemFontsPromises.set(cacheKey, cached);

    return cached;
  }

  @IpcMethod()
  async updateLocale(locale: string) {
    this.app.storeManager.set('locale', locale);

    await this.app.i18n.changeLanguage(resolveUILocale(locale));
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
    try {
      await access(legacyLocalDbDir);
      const entries = await readdir(legacyLocalDbDir);
      return entries.length > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
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
