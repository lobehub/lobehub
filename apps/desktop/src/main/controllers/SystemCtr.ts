import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import type {
  ElectronAppState,
  GitBranchInfo,
  GitBranchListItem,
  GitCheckoutResult,
  GitLinkedPullRequestResult,
  GitWorkingTreeStatus,
  ThemeMode,
} from '@lobechat/electron-client-ipc';
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
    const repoType = await this.detectRepoType(folderPath);

    return { path: folderPath, repoType };
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

  @IpcMethod()
  async detectRepoType(dirPath: string): Promise<'git' | 'github' | undefined> {
    const gitConfigPath = path.join(dirPath, '.git', 'config');
    try {
      const config = await readFile(gitConfigPath, 'utf8');
      if (config.includes('github.com')) return 'github';
      return 'git';
    } catch {
      return undefined;
    }
  }

  /**
   * Read current git branch from `.git/HEAD`. Returns short sha on detached HEAD.
   * Handles both standard `.git` directories and `.git` worktree pointer files.
   */
  @IpcMethod()
  async getGitBranch(dirPath: string): Promise<GitBranchInfo> {
    try {
      const gitDir = await this.resolveGitDir(dirPath);
      if (!gitDir) return {};

      const head = (await readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
      const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      if (refMatch) {
        return { branch: refMatch[1] };
      }
      // Detached HEAD — HEAD file contains the full sha
      if (/^[\da-f]{40}$/i.test(head)) {
        return { branch: head.slice(0, 7), detached: true };
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Query `gh` CLI for an open pull request whose head branch matches `branch`.
   * Returns status = 'gh-missing' when `gh` is not installed / not authenticated,
   * so the UI can render a helpful tooltip instead of an error.
   */
  @IpcMethod()
  async getLinkedPullRequest(payload: {
    branch: string;
    path: string;
  }): Promise<GitLinkedPullRequestResult> {
    const { path: dirPath, branch } = payload;
    if (!branch) {
      return { pullRequest: null, status: 'ok' };
    }

    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr',
          'list',
          '--head',
          branch,
          '--state',
          'open',
          '--limit',
          '5',
          '--json',
          'number,url,title,state',
        ],
        { cwd: dirPath, timeout: 8000 },
      );
      const parsed = JSON.parse(stdout.trim() || '[]') as Array<{
        number: number;
        state: string;
        title: string;
        url: string;
      }>;
      if (parsed.length === 0) {
        return { pullRequest: null, status: 'ok' };
      }
      const [primary, ...rest] = parsed;
      return {
        extraCount: rest.length,
        pullRequest: primary,
        status: 'ok',
      };
    } catch (error: any) {
      const code = error?.code;
      const stderr: string = error?.stderr ?? '';
      // `gh` binary not on PATH
      if (code === 'ENOENT') {
        return { pullRequest: null, status: 'gh-missing' };
      }
      // gh reports auth issues via stderr; treat as a soft-fail
      if (/auth\s+login|not\s+logged\s+in|authentication/i.test(stderr)) {
        return { pullRequest: null, status: 'gh-missing' };
      }
      logger.debug('[getLinkedPullRequest] failed', { branch, code, stderr });
      return { pullRequest: null, status: 'error' };
    }
  }

  /**
   * List local git branches ordered by most recent commit.
   * `current` is true for the checked-out branch.
   */
  @IpcMethod()
  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync(
        'git',
        [
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(HEAD)%09%(refname:short)%09%(upstream:short)',
          'refs/heads',
        ],
        { cwd: dirPath, timeout: 5000 },
      );
      return stdout
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          // Line format: "<HEAD-marker>\t<branch>\t<upstream>" where HEAD-marker is '*' or ' '
          const [head, name, upstream] = line.split('\t');
          return {
            current: head === '*',
            name: name ?? '',
            upstream: upstream || undefined,
          };
        })
        .filter((b) => b.name);
    } catch (error: any) {
      logger.warn('[listGitBranches] git command failed', {
        code: error?.code,
        cwd: dirPath,
        message: error?.message,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      return [];
    }
  }

  /**
   * Count unstaged / staged / untracked files via `git status --porcelain`.
   */
  @IpcMethod()
  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: dirPath,
        timeout: 5000,
      });
      const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
      return { clean: lines.length === 0, modified: lines.length };
    } catch {
      return { clean: true, modified: 0 };
    }
  }

  /**
   * Check out (or create + check out) a branch.
   * Relies on git itself to reject unsafe checkouts (dirty tree, non-fast-forward, etc.)
   * and surfaces git's stderr so the UI can display a meaningful error.
   */
  @IpcMethod()
  async checkoutGitBranch(payload: {
    branch: string;
    create?: boolean;
    path: string;
  }): Promise<GitCheckoutResult> {
    const { path: dirPath, branch, create } = payload;
    if (!branch?.trim()) {
      return { error: 'Branch name is required', success: false };
    }
    // Reject obviously invalid refs early to avoid a confusing git error
    if (/[\s~^:?*[\\]/.test(branch) || branch.startsWith('-') || branch.includes('..')) {
      return { error: `Invalid branch name: ${branch}`, success: false };
    }

    const execFileAsync = promisify(execFile);
    const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
    try {
      await execFileAsync('git', args, { cwd: dirPath, timeout: 10_000 });
      return { success: true };
    } catch (error: any) {
      const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
      logger.debug('[checkoutGitBranch] failed', { args, stderr });
      return { error: stderr || 'git checkout failed', success: false };
    }
  }

  /**
   * Resolve the actual `.git` directory for a working tree.
   * Supports both standard layouts and worktree pointer files (`.git` as a regular file).
   */
  private async resolveGitDir(dirPath: string): Promise<string | undefined> {
    const gitPath = path.join(dirPath, '.git');
    try {
      const content = await readFile(gitPath, 'utf8');
      const worktreeMatch = /^gitdir:\s*(\S.*)$/m.exec(content.trim());
      if (worktreeMatch) {
        const resolved = worktreeMatch[1].trim();
        return path.isAbsolute(resolved) ? resolved : path.resolve(dirPath, resolved);
      }
    } catch {
      // `.git` is a directory (EISDIR) or missing — fall through
    }
    try {
      const stat = await readdir(gitPath);
      if (stat.length > 0) return gitPath;
    } catch {
      return undefined;
    }
    return undefined;
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
