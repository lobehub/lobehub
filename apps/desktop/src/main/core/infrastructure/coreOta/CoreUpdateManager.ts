import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { UpdateChannel } from '@lobechat/electron-client-ipc';
import { app as electronApp, BrowserWindow, net } from 'electron';

import { type ShellGlobal, shellInfo } from '@/const/shell';
import {
  BUILD_CHANNEL,
  coerceStoredUpdateChannel,
  UPDATE_CHANNEL,
  UPDATE_SERVER_URL,
} from '@/modules/updater/configs';
import { createLogger } from '@/utils/logger';

import type { App } from '../../App';
import { type ApplyMode, computeApplyMode } from './applyMode';
import { type CoreManifest, coreManifestSchema, verifyManifestSignature } from './manifest';
import {
  type CorePointer,
  emptyPointer,
  readPointer,
  readPointerAbi,
  writePointer,
} from './pointer';
import { cleanupLegacy, CoreStore } from './store';

const logger = createLogger('core:CoreUpdateManager');

const BOOT_CHECK_TIMEOUT = 15_000;
const COLD_BOOT_CHECK_TIMEOUT = 60_000;
const FETCH_TIMEOUT = 60_000;
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000;
const LOAD_PING_TIMEOUT = 3000;
const MAX_BOOT_CRASHES = 2;
const CHECK_INTERVAL = 60 * 60 * 1000;
const FIRST_CHECK_DELAY = Number(process.env['RENDERER_OTA_CHECK_DELAY']) || 90 * 1000;
const IDLE_APPLY_DELAY = 5 * 60 * 1000;
const RENDERER_ROOT = 'dist/renderer';
const FEED_BASE_URL =
  UPDATE_SERVER_URL?.replace(/\/(stable|nightly|canary|beta)\/?$/, '').replace(/\/$/, '') || '';

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
type CoreChannel = CoreManifest['channel'];
type Staged = { applyMode: ApplyMode; version: string };
type Options = { fetchImpl?: FetchImpl; shell?: ShellGlobal };

const readBuiltinManifest = (shell: ShellGlobal): CoreManifest | null => {
  if (shell.source === 'builtin') return shell.manifest;
  try {
    const raw = JSON.parse(readFileSync(path.join(shell.builtinDir, 'manifest.json'), 'utf8'));
    return coreManifestSchema.parse(raw);
  } catch {
    return null;
  }
};

class SkipCheck extends Error {}

export class CoreUpdateManager {
  private readonly app: App;
  private readonly shell: ShellGlobal | undefined;
  private readonly fetchImpl: FetchImpl;
  private readonly otaRoot: string;
  private readonly store: CoreStore;
  private readonly builtinManifest: CoreManifest | null;
  readonly disabledReasons: string[];
  private activeChannel: CoreChannel;
  private pointer: CorePointer;
  private staged: Staged | null = null;
  private busy = false;
  private checkGeneration = 0;
  private lastCheckAt: number | null = null;
  private lastError: string | null = null;
  private needsFullRelease = false;
  private unloadPrevented = false;
  private rollbackRendererDir: string | null = null;
  private pendingBootCheck = false;
  private coldBootCheck = false;
  private mountedSeen = false;
  private bootCrashCount = 0;
  private bootCheckTimer: NodeJS.Timeout | null = null;
  private loadPingTimer: NodeJS.Timeout | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private gcTask: Promise<void> = Promise.resolve();
  private checkTask: Promise<void> = Promise.resolve();

  constructor(app: App, options: Options = {}) {
    this.app = app;
    this.shell = options.shell ?? shellInfo;
    this.fetchImpl =
      options.fetchImpl ??
      ((url, init) => net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT), ...init }));
    this.otaRoot = path.join(electronApp.getPath('userData'), 'core-ota');
    this.store = new CoreStore(this.otaRoot, (url) =>
      this.fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) }),
    );
    this.builtinManifest = this.shell ? readBuiltinManifest(this.shell) : null;
    this.activeChannel = this.coreChannel(
      coerceStoredUpdateChannel(this.app.storeManager.get('updateChannel') as string | undefined) ||
        UPDATE_CHANNEL,
    );
    this.pointer = emptyPointer(this.shell?.abi ?? '');
    this.disabledReasons = [
      !this.shell && 'missing-shell',
      this.shell && !this.shell.manifest && 'missing-core-manifest',
      this.shell && !this.builtinManifest && 'missing-builtin-manifest',
      this.shell && !this.shell.publicKey && 'missing-public-key',
      !FEED_BASE_URL && 'missing-server-url',
    ].filter((reason): reason is string => typeof reason === 'string');
  }

  get enabled() {
    return this.disabledReasons.length === 0;
  }

  private get running() {
    return this.shell!.manifest!;
  }

  private get runningVersion() {
    return this.shell?.source === 'external' ? this.running.version : null;
  }

  private get keepVersions() {
    const { current, previous, staged } = this.pointer;
    return [current, previous, staged, this.runningVersion].filter((v): v is string => !!v);
  }

  initialize = () => {
    logger.info('Core OTA configuration', {
      abi: this.shell?.abi,
      channel: this.activeChannel,
      disabledReasons: this.disabledReasons,
      enabled: this.enabled,
      running: this.runningVersion ?? 'builtin',
      source: this.shell?.source,
    });
    if (!this.enabled) return;

    rmSync(path.join(this.otaRoot, 'staging'), { force: true, recursive: true });
    cleanupLegacy(electronApp.getPath('userData')).catch((error) =>
      logger.warn('Legacy renderer OTA cleanup failed:', error),
    );
    const abiChanged = readPointerAbi(this.otaRoot) !== this.shell!.abi;
    const stored = readPointer(this.otaRoot, this.shell!.abi);
    this.pointer = { ...this.reconcilePointer(stored), channel: this.activeChannel };
    writePointer(this.otaRoot, this.pointer);
    logger.info('Core OTA boot state', this.pointer);
    this.gc(abiChanged);
  };

  private reconcilePointer(pointer: CorePointer): CorePointer {
    const running = this.runningVersion;
    if (!running && pointer.current) {
      const rejected = existsSync(path.join(this.coreDirOf(pointer.current), 'manifest.json'));
      return {
        ...pointer,
        blacklist: rejected
          ? [...new Set([...pointer.blacklist, pointer.current])]
          : pointer.blacklist,
        current: null,
        previous: null,
      };
    }
    if (running && pointer.current !== running) {
      return { ...pointer, current: running, previous: null };
    }
    return pointer;
  }

  private isFirstBootOfRunningCore() {
    try {
      const boot = JSON.parse(readFileSync(path.join(this.otaRoot, 'boot.json'), 'utf8'));
      return boot?.version === this.runningVersion && boot?.healthy !== true;
    } catch {
      return false;
    }
  }

  startScheduledChecks = () => {
    if (!this.enabled) return;
    if (this.runningVersion && !this.mountedSeen && this.isFirstBootOfRunningCore()) {
      this.armBootCheck({ cold: true });
    }
    electronApp.on('browser-window-blur', this.handleWindowBlur);
    electronApp.on('browser-window-focus', this.clearIdleTimer);
    this.scheduleChecks();
  };

  switchChannel = (channel: UpdateChannel) => {
    const next = this.coreChannel(channel);
    if (next === this.activeChannel) return;
    logger.info('Core OTA channel changed', { from: this.activeChannel, to: next });
    this.activeChannel = next;
    if (!this.enabled) return;
    this.checkGeneration += 1;
    this.busy = false;
    this.savePointer({
      channel: next,
      staged: null,
      ...(this.staged?.applyMode === 'relaunch'
        ? { current: this.pointer.previous, previous: null }
        : {}),
    });
    this.staged = null;
    this.gc();
    if (this.checkTimer || this.checkInterval) this.scheduleChecks();
  };

  handleBootPing = (stage?: 'loaded' | 'mounted') => {
    if (stage !== 'loaded') this.mountedSeen = true;
    if (!this.pendingBootCheck) return;
    if (stage === 'loaded') {
      this.clearLoadPingTimer();
      return;
    }
    logger.info(`Core ${this.pointer.current} boot check passed`);
    this.clearBootTimers();
    this.pendingBootCheck = false;
    this.bootCrashCount = 0;
    this.rollbackRendererDir = null;
    this.gc();
  };

  handleRendererCrash = () => {
    if (!this.pendingBootCheck) return;
    this.bootCrashCount += 1;
    logger.warn(`Renderer crashed during boot check (${this.bootCrashCount}/${MAX_BOOT_CRASHES})`);
    if (this.bootCrashCount >= MAX_BOOT_CRASHES) this.failBootCheck('renderer-crash');
  };

  handleUnloadPrevented = () => {
    this.unloadPrevented = true;
    if (!this.pendingBootCheck || this.coldBootCheck) return;
    logger.info('Reload cancelled by renderer, cancelling boot check');
    this.clearBootTimers();
    this.pendingBootCheck = false;
    this.rollbackRendererDir = null;
  };

  applyStagedNow = () => {
    if (!this.staged) return false;
    if (this.staged.applyMode === 'relaunch') {
      this.relaunchIntoCore();
      return true;
    }
    const { version } = this.staged;
    logger.info(`Applying core ${version} renderer now`);
    const rendererDir = this.rendererDirOf(version);
    this.rollbackRendererDir = this.app.rendererUrlManager.getActiveRendererDir();
    this.app.rendererUrlManager.setActiveRendererDir(rendererDir);
    if (this.app.rendererUrlManager.getActiveRendererDir() !== rendererDir) {
      this.app.rendererUrlManager.setActiveRendererDir(this.rollbackRendererDir);
      this.rollbackRendererDir = null;
      this.savePointer({
        blacklist: [...new Set([...this.pointer.blacklist, version])],
        staged: null,
      });
      this.staged = null;
      return false;
    }
    this.savePointer({ current: version, previous: this.pointer.current, staged: null });
    this.staged = null;
    this.clearIdleTimer();
    this.reloadAllWindows();
    this.armBootCheck();
    return true;
  };

  getStatus = () => ({
    applyMode: this.staged?.applyMode ?? null,
    current: this.pointer.current,
    disabledReasons: this.disabledReasons,
    enabled: this.enabled,
    lastCheckAt: this.lastCheckAt,
    lastError: this.lastError,
    needsFullRelease: this.needsFullRelease,
    staged: this.staged?.version ?? null,
  });

  checkForUpdates = () => {
    this.checkTask = this.checkTask.catch(() => {}).then(() => this.runCheck());
    return this.checkTask;
  };

  private async runCheck() {
    if (!this.enabled || this.busy || this.staged) {
      logger.info('Core OTA check skipped', {
        reason: !this.enabled ? 'disabled' : this.busy ? 'busy' : 'already-staged',
      });
      return;
    }
    const generation = this.checkGeneration;
    const feedUrl = this.feedUrl();
    this.busy = true;
    this.lastCheckAt = Date.now();
    let outcome = 'skipped';
    try {
      const remote = await this.fetchRemote(feedUrl, generation);
      if (!remote) return;
      const { version } = remote;
      this.needsFullRelease = remote.shellAbi !== this.shell!.abi;
      if (this.needsFullRelease) throw new SkipCheck('needs-full-release');
      if (remote.channel === this.running.channel && remote.seq <= this.running.seq)
        throw new SkipCheck('up-to-date');
      if (version === this.pointer.current) throw new SkipCheck('already-current');
      if (this.pointer.blacklist.includes(version)) throw new SkipCheck('blacklisted');
      if (!this.inRollout(version, remote.rollout)) throw new SkipCheck('rollout-excluded');

      await this.gcTask;
      const staged = await this.store.stage({
        builtin: { dir: this.shell!.builtinDir, manifest: this.builtinManifest! },
        current:
          this.shell!.source === 'external'
            ? { dir: this.shell!.coreDir, manifest: this.running }
            : null,
        objectsBaseUrl: remote.objectsBaseUrl,
        packsBaseUrl: feedUrl,
        remote,
      });
      if (generation !== this.checkGeneration) throw new SkipCheck('superseded');
      const applyMode = computeApplyMode(this.running.tree, remote.tree);
      logger.info('Core OTA staged', { applyMode, version, ...staged.downloaded });
      this.staged = { applyMode, version };
      this.savePointer(
        applyMode === 'relaunch'
          ? { current: version, previous: this.pointer.current, staged: null }
          : { staged: version },
      );
      this.lastError = null;
      this.app.browserManager.broadcastToAllWindows('updateReady', {
        kind: applyMode === 'relaunch' ? 'core-relaunch' : 'core-reload',
        version,
      });
      this.gc();
      if (applyMode === 'reload') this.handleWindowBlur();
      outcome = 'staged';
    } catch (error) {
      if (error instanceof SkipCheck) {
        outcome = error.message;
        return;
      }
      outcome = 'failed';
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.error('Core OTA check failed:', error);
      if (generation === this.checkGeneration) {
        rmSync(path.join(this.otaRoot, 'staging'), { force: true, recursive: true });
      }
    } finally {
      if (generation === this.checkGeneration) this.busy = false;
      logger.info('Core OTA check finished', { channel: this.activeChannel, outcome });
    }
  }

  private async fetchRemote(feedUrl: string, generation: number): Promise<CoreManifest | null> {
    const res = await this.fetchImpl(`${feedUrl}/latest.json`, { cache: 'no-store' });
    if (res.status === 404) throw new SkipCheck('feed-not-found');
    if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
    const parsed = coreManifestSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('Manifest shape invalid');
    const remote = parsed.data;
    if (!verifyManifestSignature(remote, this.shell!.publicKey)) {
      throw new Error('Manifest signature invalid');
    }
    if (generation !== this.checkGeneration) throw new SkipCheck('superseded');
    if (remote.channel !== this.activeChannel) throw new Error('Manifest channel mismatch');
    if (remote.platform !== process.platform) throw new Error('Manifest platform mismatch');
    return remote;
  }

  private inRollout(version: string, rollout: number) {
    if (rollout >= 1) return true;
    const digest = createHash('sha256')
      .update(electronApp.getPath('userData') + version)
      .digest();
    return digest.readUInt32BE(0) / 2 ** 32 < rollout;
  }

  private coreChannel(channel: UpdateChannel): CoreChannel {
    return BUILD_CHANNEL === 'beta' && channel === 'canary' ? 'beta' : channel;
  }

  private feedUrl() {
    return `${FEED_BASE_URL}/${this.activeChannel}/core/${process.platform}`;
  }

  private coreDirOf(version: string) {
    return path.join(this.otaRoot, 'cores', version);
  }

  private rendererDirOf(version: string) {
    return path.join(this.coreDirOf(version), RENDERER_ROOT);
  }

  private savePointer(patch: Partial<CorePointer>) {
    this.pointer = { ...this.pointer, ...patch };
    writePointer(this.otaRoot, this.pointer);
  }

  private scheduleChecks() {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkTimer = setTimeout(() => this.checkForUpdates(), FIRST_CHECK_DELAY);
    this.checkInterval = setInterval(() => this.checkForUpdates(), CHECK_INTERVAL);
    this.checkTimer.unref?.();
    this.checkInterval.unref?.();
  }

  private relaunchIntoCore() {
    logger.info(`Relaunching into core ${this.pointer.current}`);
    this.app.updaterManager?.captureRestoreRoute();
    this.app.isQuiting = true;
    electronApp.releaseSingleInstanceLock();
    electronApp.relaunch(
      process.env.APPIMAGE
        ? { args: process.argv.slice(1), execPath: process.env.APPIMAGE }
        : { args: process.argv.slice(1) },
    );
    electronApp.quit();
  }

  private handleWindowBlur = () => {
    if (BrowserWindow.getAllWindows().some((window) => window.isFocused())) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.staged?.applyMode === 'reload' && !this.unloadPrevented) this.applyStagedNow();
    }, IDLE_APPLY_DELAY);
    this.idleTimer.unref?.();
  };

  private clearIdleTimer = () => {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  };

  private failBootCheck(reason: string) {
    this.clearBootTimers();
    const bad = this.pointer.current;
    const coldBoot = this.coldBootCheck;
    logger.warn('Core OTA rolled back', { coldBoot, failedVersion: bad, reason });
    this.pendingBootCheck = false;
    this.savePointer({
      blacklist: bad ? [...new Set([...this.pointer.blacklist, bad])] : this.pointer.blacklist,
      current: this.pointer.previous,
      previous: null,
    });
    if (coldBoot) {
      this.relaunchIntoCore();
      return;
    }
    this.app.rendererUrlManager.setActiveRendererDir(this.rollbackRendererDir);
    this.rollbackRendererDir = null;
    this.gc();
    this.reloadAllWindows();
  }

  private armBootCheck({ cold = false } = {}) {
    this.pendingBootCheck = true;
    this.coldBootCheck = cold;
    this.bootCrashCount = 0;
    this.clearBootTimers();
    if (!cold) {
      this.loadPingTimer = setTimeout(() => this.failBootCheck('load-timeout'), LOAD_PING_TIMEOUT);
      this.loadPingTimer.unref?.();
    }
    this.bootCheckTimer = setTimeout(
      () => this.failBootCheck('boot-timeout'),
      cold ? COLD_BOOT_CHECK_TIMEOUT : BOOT_CHECK_TIMEOUT,
    );
    this.bootCheckTimer.unref?.();
  }

  private clearLoadPingTimer() {
    if (this.loadPingTimer) clearTimeout(this.loadPingTimer);
    this.loadPingTimer = null;
  }

  private clearBootTimers() {
    this.clearLoadPingTimer();
    if (this.bootCheckTimer) clearTimeout(this.bootCheckTimer);
    this.bootCheckTimer = null;
  }

  private reloadAllWindows() {
    this.app.browserManager.browsers.forEach((browser) => {
      try {
        browser.browserWindow.webContents.reloadIgnoringCache();
      } catch {}
    });
  }

  private gc(keepStore = false) {
    this.gcTask = this.gcTask
      .then(() => this.store.gc(this.keepVersions, { keepStore }))
      .catch((error) => logger.warn('Core OTA gc failed:', error));
  }
}
