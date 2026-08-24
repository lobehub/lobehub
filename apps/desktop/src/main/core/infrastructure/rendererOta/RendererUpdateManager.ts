import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { app as electronApp } from 'electron';

import { rendererDir } from '@/const/dir';
import { isDev } from '@/const/env';
import {
  coerceStoredUpdateChannel,
  UPDATE_CHANNEL,
  UPDATE_SERVER_URL,
} from '@/modules/updater/configs';
import { createLogger } from '@/utils/logger';

import type { App } from '../../App';
import {
  diffManifest,
  findMissingEntryAssets,
  isValidManifestShape,
  patchNumber,
  type RendererManifest,
  sha256File,
  verifyManifestSignature,
} from './manifest';
import { emptyPointer, type OtaPointer, readPointer, writePointer } from './pointer';

const logger = createLogger('core:RendererUpdateManager');

const BOOT_CHECK_TIMEOUT = 15_000;
const LOAD_PING_TIMEOUT = 3000;
const MAX_BOOT_CRASHES = 2;
const CHECK_INTERVAL = 60 * 60 * 1000;

const MAIN_HASH = process.env.MAIN_HASH || '';
const PUBLIC_KEY = process.env.RENDERER_OTA_PUBLIC_KEY || '';
// Local e2e escape hatches (never set in packaged builds): force-enable in
// dev and shorten the first scheduled check.
const FORCE_IN_DEV = process.env['RENDERER_OTA_FORCE'] === '1';
const FIRST_CHECK_DELAY = Number(process.env['RENDERER_OTA_CHECK_DELAY']) || 90 * 1000;

type OtaState = 'idle' | 'checking' | 'downloading' | 'staged';

export class RendererUpdateManager {
  private readonly app: App;
  private readonly otaDir: string;
  private pointer: OtaPointer;
  private state: OtaState = 'idle';
  private stagedManifest: RendererManifest | null = null;
  private bootCheckTimer: NodeJS.Timeout | null = null;
  private loadPingTimer: NodeJS.Timeout | null = null;
  private bootCrashCount = 0;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(app: App) {
    this.app = app;
    this.otaDir = path.join(electronApp.getPath('userData'), 'renderer-ota');
    this.pointer = emptyPointer(MAIN_HASH);
  }

  get enabled() {
    return (!isDev || FORCE_IN_DEV) && !!MAIN_HASH && !!PUBLIC_KEY && !!UPDATE_SERVER_URL;
  }

  /**
   * Must run before the first window loads: resolves the pointer, applies a
   * restart-pending staged version, garbage-collects, and sets the app://
   * serving root.
   */
  initialize = () => {
    if (!this.enabled) {
      logger.info('Renderer OTA disabled (dev build or missing MAIN_HASH/key/server url)');
      return;
    }

    mkdirSync(path.join(this.otaDir, 'versions'), { recursive: true });
    this.pointer = readPointer(this.otaDir, MAIN_HASH);

    if (this.pointer.staged && this.versionDirValid(this.pointer.staged)) {
      logger.info(`Applying staged renderer ${this.pointer.staged} on boot`);
      this.promoteToCurrent(this.pointer.staged);
    } else if (this.pointer.pendingBootCheck && this.pointer.current) {
      // Previous session died before the boot check passed — treat as a failed boot.
      logger.warn(`Renderer ${this.pointer.current} never passed boot check, rolling back`);
      this.rollback();
    }

    this.gc();
    writePointer(this.otaDir, this.pointer);
    this.applyServingRoot();

    if (this.pointer.pendingBootCheck) this.armBootCheck();
  };

  startScheduledChecks = () => {
    if (!this.enabled) return;
    this.checkTimer = setTimeout(() => this.checkForUpdates(), FIRST_CHECK_DELAY);
    setInterval(() => this.checkForUpdates(), CHECK_INTERVAL);
  };

  handleBootPing = (stage?: 'loaded' | 'mounted') => {
    if (!this.pointer.pendingBootCheck) return;

    if (stage === 'loaded') {
      logger.info(`Renderer ${this.pointer.current} bundle evaluated (load ping)`);
      this.clearLoadPingTimer();
      return;
    }

    logger.info(`Renderer ${this.pointer.current} boot check passed`);
    this.clearBootTimers();
    this.bootCrashCount = 0;
    this.pointer = { ...this.pointer, pendingBootCheck: false };
    writePointer(this.otaDir, this.pointer);
    this.gc();
  };

  handleRendererCrash = () => {
    if (!this.pointer.pendingBootCheck) return;
    this.bootCrashCount += 1;
    logger.warn(`Renderer crashed during boot check (${this.bootCrashCount}/${MAX_BOOT_CRASHES})`);
    if (this.bootCrashCount >= MAX_BOOT_CRASHES) this.failBootCheck();
  };

  applyStagedNow = () => {
    if (!this.pointer.staged || !this.versionDirValid(this.pointer.staged)) return false;
    logger.info(`Applying staged renderer ${this.pointer.staged} now`);
    this.promoteToCurrent(this.pointer.staged);
    this.stagedManifest = null;
    this.state = 'idle';
    this.applyServingRoot();
    this.reloadAllWindows();
    // Hot apply is an in-place reload from local disk: the bundle must
    // evaluate within seconds, so a missing load ping fails fast. Cold-boot
    // arming (initialize) keeps only the long mount timeout.
    this.armBootCheck({ expectFastLoad: true });
    return true;
  };

  getStatus = () => ({
    current: this.pointer.current,
    enabled: this.enabled,
    staged: this.pointer.staged,
    state: this.state,
  });

  checkForUpdates = async () => {
    if (!this.enabled || this.state !== 'idle') return;
    this.state = 'checking';

    try {
      const manifest = await this.fetchManifest();
      if (!manifest) return;

      const currentN = this.pointer.current ? patchNumber(this.pointer.current) : 0;
      if (
        patchNumber(manifest.version) <= currentN ||
        this.pointer.blacklist.includes(manifest.version) ||
        this.pointer.staged === manifest.version
      ) {
        return;
      }

      this.state = 'downloading';
      await this.downloadAndStage(manifest);

      this.stagedManifest = manifest;
      this.pointer = { ...this.pointer, staged: manifest.version };
      writePointer(this.otaDir, this.pointer);
      this.state = 'staged';

      logger.info(`Renderer ${manifest.version} staged (app ${manifest.appVersion})`);
      this.app.browserManager.broadcastToAllWindows('rendererUpdateReady', {
        appVersion: manifest.appVersion,
        version: manifest.version,
      });
      return;
    } catch (error) {
      logger.error('Renderer OTA check failed:', error);
      rmSync(path.join(this.otaDir, 'staging'), { force: true, recursive: true });
    } finally {
      if (this.state !== 'staged') this.state = 'idle';
    }
  };

  private get channel() {
    return (
      coerceStoredUpdateChannel(this.app.storeManager.get('updateChannel') as string | undefined) ||
      UPDATE_CHANNEL
    );
  }

  private feedUrl() {
    return `${UPDATE_SERVER_URL}/renderer/${this.channel}/${MAIN_HASH}/latest.json`;
  }

  private fileUrl(sha256: string) {
    return `${UPDATE_SERVER_URL}/renderer/files/${sha256}.bin`;
  }

  private async fetchManifest(): Promise<RendererManifest | null> {
    const res = await fetch(this.feedUrl(), { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);

    const raw = await res.json();
    if (!isValidManifestShape(raw)) throw new Error('Manifest shape invalid');
    if (raw.mainHash !== MAIN_HASH) throw new Error('Manifest mainHash mismatch');
    if (!verifyManifestSignature(raw, PUBLIC_KEY)) throw new Error('Manifest signature invalid');
    return raw;
  }

  private async downloadAndStage(manifest: RendererManifest) {
    const stagingRoot = path.join(this.otaDir, 'staging');
    rmSync(stagingRoot, { force: true, recursive: true });
    const stagingDir = path.join(stagingRoot, manifest.version);
    mkdirSync(stagingDir, { recursive: true });

    const { missing, reusable } = diffManifest(manifest, this.hashLocalTree());
    logger.info(
      `Renderer ${manifest.version}: ${reusable.length} files reused, ${missing.length} to download`,
    );

    for (const { file, localPath } of reusable) {
      const target = path.join(stagingDir, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      try {
        linkSync(localPath, target);
      } catch {
        writeFileSync(target, readFileSync(localPath));
      }
    }

    for (const file of missing) {
      const res = await fetch(this.fileUrl(file.sha256));
      if (!res.ok) throw new Error(`Asset fetch failed (${res.status}): ${file.path}`);
      const content = Buffer.from(await res.arrayBuffer());
      const target = path.join(stagingDir, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    for (const file of manifest.files) {
      const content = readFileSync(path.join(stagingDir, file.path));
      if (sha256File(content) !== file.sha256) {
        throw new Error(`Hash mismatch after staging: ${file.path}`);
      }
    }

    const entryHtml = readFileSync(path.join(stagingDir, 'apps', 'desktop', 'index.html'), 'utf8');
    const missingAssets = findMissingEntryAssets(entryHtml, (relPath) =>
      existsSync(path.join(stagingDir, relPath)),
    );
    if (missingAssets.length > 0) {
      throw new Error(`Entry integrity check failed: ${missingAssets.join(', ')}`);
    }

    const finalDir = path.join(this.otaDir, 'versions', manifest.version);
    rmSync(finalDir, { force: true, recursive: true });
    renameSync(stagingDir, finalDir);
    rmSync(stagingRoot, { force: true, recursive: true });
  }

  private hashLocalTree(): Map<string, string> {
    const root = this.pointer.current
      ? path.join(this.otaDir, 'versions', this.pointer.current)
      : rendererDir;
    const hashes = new Map<string, string>();

    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else hashes.set(full, sha256File(readFileSync(full)));
      }
    };
    walk(root);
    return hashes;
  }

  private versionDirValid(version: string) {
    return existsSync(path.join(this.otaDir, 'versions', version, 'apps', 'desktop', 'index.html'));
  }

  private promoteToCurrent(version: string) {
    this.pointer = {
      ...this.pointer,
      current: version,
      pendingBootCheck: true,
      previous: this.pointer.current,
      staged: this.pointer.staged === version ? null : this.pointer.staged,
    };
    writePointer(this.otaDir, this.pointer);
  }

  private rollback() {
    const bad = this.pointer.current;
    const fallback =
      this.pointer.previous && this.versionDirValid(this.pointer.previous)
        ? this.pointer.previous
        : null;

    this.pointer = {
      ...this.pointer,
      blacklist: bad ? [...new Set([...this.pointer.blacklist, bad])] : this.pointer.blacklist,
      current: fallback,
      pendingBootCheck: false,
      previous: null,
    };
    writePointer(this.otaDir, this.pointer);
    logger.warn(`Rolled back renderer to ${fallback ?? 'builtin bundle'} (blacklisted ${bad})`);
    this.gc();
  }

  private failBootCheck() {
    this.clearBootTimers();
    this.rollback();
    this.applyServingRoot();
    this.reloadAllWindows();
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

  private armBootCheck(options?: { expectFastLoad?: boolean }) {
    this.bootCrashCount = 0;
    this.clearBootTimers();

    if (options?.expectFastLoad) {
      this.loadPingTimer = setTimeout(() => {
        logger.warn(`No load ping within ${LOAD_PING_TIMEOUT}ms`);
        this.failBootCheck();
      }, LOAD_PING_TIMEOUT);
      this.loadPingTimer.unref?.();
    }

    this.bootCheckTimer = setTimeout(() => {
      logger.warn(`No boot ping within ${BOOT_CHECK_TIMEOUT}ms`);
      this.failBootCheck();
    }, BOOT_CHECK_TIMEOUT);
    this.bootCheckTimer.unref?.();
  }

  private applyServingRoot() {
    const dir =
      this.pointer.current && this.versionDirValid(this.pointer.current)
        ? path.join(this.otaDir, 'versions', this.pointer.current)
        : null;
    this.app.rendererUrlManager.setActiveRendererDir(dir);
  }

  private reloadAllWindows() {
    this.app.browserManager.browsers.forEach((browser) => {
      try {
        browser.browserWindow.webContents.reload();
      } catch {
        /* window may be destroyed */
      }
    });
  }

  private gc() {
    const versionsDir = path.join(this.otaDir, 'versions');
    const keep = new Set(
      [this.pointer.current, this.pointer.previous, this.pointer.staged].filter(Boolean),
    );

    rmSync(path.join(this.otaDir, 'staging'), { force: true, recursive: true });

    let entries;
    try {
      entries = readdirSync(versionsDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!keep.has(entry)) {
        logger.debug(`GC renderer version ${entry}`);
        rmSync(path.join(versionsDir, entry), { force: true, recursive: true });
      }
    }
  }
}
