import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { UpdateChannel } from '@lobechat/electron-client-ipc';
import { app as electronApp } from 'electron';

import { rendererDir } from '@/const/dir';
import { isDev } from '@/const/env';
import {
  BUILD_CHANNEL,
  coerceStoredUpdateChannel,
  UPDATE_CHANNEL,
  UPDATE_SERVER_URL,
} from '@/modules/updater/configs';
import { createLogger } from '@/utils/logger';

import type { App } from '../../App';
import {
  findMissingEntryAssets,
  isValidManifestShape,
  patchNumber,
  type RendererArtifact,
  type RendererDelta,
  type RendererManifest,
  type RendererTreeFile,
  sha256File,
  verifyManifestSignature,
} from './manifest';
import { decodeRendererPack } from './pack';
import { emptyPointer, type OtaPointer, readPointer, writePointer } from './pointer';
import { canApplyDelta, indexLocalByHash, pickDelta } from './updatePlan';
import { applyZstdPatch } from './zstdPatch';

const logger = createLogger('core:RendererUpdateManager');

const BOOT_CHECK_TIMEOUT = 15_000;
const LOAD_PING_TIMEOUT = 3000;
const MAX_BOOT_CRASHES = 2;
const CHECK_INTERVAL = 60 * 60 * 1000;

const APP_VERSION = electronApp.getVersion();
const MAIN_HASH = process.env.MAIN_HASH || '';
const PUBLIC_KEY = process.env.RENDERER_OTA_PUBLIC_KEY || '';
const UPDATE_SERVER_BASE_URL =
  UPDATE_SERVER_URL?.replace(/\/(stable|nightly|canary|beta)\/?$/, '').replace(/\/$/, '') || '';
// Local e2e escape hatches (never set in packaged builds): force-enable in
// dev and shorten the first scheduled check.
const FORCE_IN_DEV = process.env['RENDERER_OTA_FORCE'] === '1';
const FIRST_CHECK_DELAY = Number(process.env['RENDERER_OTA_CHECK_DELAY']) || 90 * 1000;

type OtaState = 'idle' | 'checking' | 'downloading' | 'staged';
type RendererOtaChannel = UpdateChannel | 'beta';

export class RendererUpdateManager {
  private readonly app: App;
  private readonly legacyOtaRootDir: string;
  private readonly otaRootDir: string;
  private activeChannel: RendererOtaChannel;
  private pointer: OtaPointer;
  private state: OtaState = 'idle';
  private stagedManifest: RendererManifest | null = null;
  private bootCheckTimer: NodeJS.Timeout | null = null;
  private loadPingTimer: NodeJS.Timeout | null = null;
  private bootCrashCount = 0;
  private checkTimer: NodeJS.Timeout | null = null;
  private checkGeneration = 0;

  constructor(app: App) {
    this.app = app;
    const userDataDir = electronApp.getPath('userData');
    this.legacyOtaRootDir = path.join(userDataDir, 'renderer-ota');
    this.otaRootDir = path.join(userDataDir, 'renderer-ota-v2');
    this.activeChannel = this.rendererChannel(
      coerceStoredUpdateChannel(this.app.storeManager.get('updateChannel') as string | undefined) ||
        UPDATE_CHANNEL,
    );
    this.pointer = emptyPointer(MAIN_HASH);
  }

  private get otaDir() {
    return path.join(this.otaRootDir, this.activeChannel);
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
    this.cleanupLegacyV1();

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

  switchChannel = (channel: UpdateChannel) => {
    const nextChannel = this.rendererChannel(channel);
    if (nextChannel === this.activeChannel) return;

    if (!this.enabled) {
      this.activeChannel = nextChannel;
      return;
    }

    this.checkGeneration += 1;
    this.clearBootTimers();
    this.state = 'idle';
    this.stagedManifest = null;
    this.activeChannel = nextChannel;

    mkdirSync(path.join(this.otaDir, 'versions'), { recursive: true });
    this.pointer = readPointer(this.otaDir, MAIN_HASH);
    if (this.pointer.pendingBootCheck) this.rollback();
    this.state = this.pointer.staged ? 'staged' : 'idle';
    this.gc();
    writePointer(this.otaDir, this.pointer);
    this.applyServingRoot();
    this.reloadAllWindows();
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
    const generation = this.checkGeneration;
    const channel = this.activeChannel;
    const otaDir = this.otaDir;
    const pointer = this.pointer;
    this.state = 'checking';

    try {
      const rendererUrl = this.rendererUrl(channel);
      const manifest = await this.fetchManifest(rendererUrl);
      if (!manifest || generation !== this.checkGeneration) return;

      const currentN = pointer.current ? patchNumber(pointer.current) : 0;
      if (
        patchNumber(manifest.version) <= currentN ||
        pointer.blacklist.includes(manifest.version) ||
        pointer.staged === manifest.version
      ) {
        return;
      }

      this.state = 'downloading';
      await this.downloadAndStage(manifest, otaDir, pointer, rendererUrl);
      if (generation !== this.checkGeneration) return;

      this.stagedManifest = manifest;
      this.pointer = { ...this.pointer, staged: manifest.version };
      writePointer(otaDir, this.pointer);
      this.state = 'staged';

      logger.info(`Renderer ${manifest.version} staged (app ${manifest.appVersion})`);
      this.app.browserManager.broadcastToAllWindows('updateReady', {
        kind: 'renderer',
        version: manifest.appVersion,
      });
      return;
    } catch (error) {
      if (generation === this.checkGeneration) logger.error('Renderer OTA check failed:', error);
      rmSync(path.join(otaDir, 'staging'), { force: true, recursive: true });
    } finally {
      if (generation === this.checkGeneration && this.state !== 'staged') this.state = 'idle';
    }
  };

  private rendererChannel(channel: UpdateChannel): RendererOtaChannel {
    return BUILD_CHANNEL === 'beta' && channel === 'canary' ? 'beta' : channel;
  }

  private cleanupLegacyV1() {
    if (!existsSync(this.legacyOtaRootDir)) return;

    try {
      rmSync(this.legacyOtaRootDir, { force: true, recursive: true });
      logger.info('Removed legacy Renderer OTA V1 data');
    } catch (error) {
      logger.warn(`Failed to remove legacy Renderer OTA V1 data: ${String(error)}`);
    }
  }

  private rendererUrl(channel: RendererOtaChannel) {
    return `${UPDATE_SERVER_BASE_URL}/${channel}/${APP_VERSION}/renderer/v2`;
  }

  private async fetchManifest(rendererUrl: string): Promise<RendererManifest | null> {
    const res = await fetch(`${rendererUrl}/latest.json`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);

    const raw = await res.json();
    if (!isValidManifestShape(raw)) throw new Error('Manifest shape invalid');
    if (raw.appVersion !== APP_VERSION) throw new Error('Manifest appVersion mismatch');
    if (raw.mainHash !== MAIN_HASH) throw new Error('Manifest mainHash mismatch');
    if (!verifyManifestSignature(raw, PUBLIC_KEY)) throw new Error('Manifest signature invalid');
    return raw;
  }

  private async downloadAndStage(
    manifest: RendererManifest,
    otaDir: string,
    pointer: OtaPointer,
    rendererUrl: string,
  ) {
    const stagingRoot = path.join(otaDir, 'staging');
    rmSync(stagingRoot, { force: true, recursive: true });
    const stagingDir = path.join(stagingRoot, manifest.version);
    mkdirSync(stagingDir, { recursive: true });

    const localHashes = await this.hashLocalTree(otaDir, pointer);
    const byHash = indexLocalByHash(localHashes);
    const localVersion = pointer.current ?? 'r0';
    const delta = pickDelta(manifest, localVersion);
    let targetTree: RendererTreeFile[];

    if (delta) {
      logger.info(`Renderer ${manifest.version}: applying delta from ${delta.fromVersion}`);
      try {
        targetTree = await this.stageDelta(manifest, delta, stagingDir, byHash, rendererUrl);
      } catch (error) {
        logger.warn(`Renderer delta failed, retrying full pack: ${String(error)}`);
        rmSync(stagingDir, { force: true, recursive: true });
        mkdirSync(stagingDir, { recursive: true });
        targetTree = await this.stageFull(manifest, stagingDir, rendererUrl);
      }
    } else {
      logger.info(`Renderer ${manifest.version}: applying full pack`);
      targetTree = await this.stageFull(manifest, stagingDir, rendererUrl);
    }

    for (const file of targetTree) {
      const content = await readFile(path.join(stagingDir, file.path));
      if (content.byteLength !== file.size || sha256File(content) !== file.sha256) {
        throw new Error(`Hash mismatch after staging: ${file.path}`);
      }
    }

    for (const entry of ['index.html', 'popup.html', 'overlay.html']) {
      const entryHtml = await readFile(path.join(stagingDir, 'apps', 'desktop', entry), 'utf8');
      const missingAssets = findMissingEntryAssets(entryHtml, (relPath) =>
        existsSync(path.join(stagingDir, relPath)),
      );
      if (missingAssets.length > 0) {
        throw new Error(`Entry integrity check failed (${entry}): ${missingAssets.join(', ')}`);
      }
    }

    const finalDir = path.join(otaDir, 'versions', manifest.version);
    rmSync(finalDir, { force: true, recursive: true });
    renameSync(stagingDir, finalDir);
    rmSync(stagingRoot, { force: true, recursive: true });
  }

  private async stageFull(
    manifest: RendererManifest,
    stagingDir: string,
    rendererUrl: string,
  ): Promise<RendererTreeFile[]> {
    const { entries, metadata } = await this.fetchPack(rendererUrl, manifest.full, {
      kind: 'full',
      version: manifest.version,
    });
    if (metadata.kind !== 'full') throw new Error('Full pack metadata mismatch');
    for (const file of metadata.tree) {
      const content = entries.get(`objects/${file.sha256}`);
      if (!content) throw new Error(`Full pack missing ${file.path}`);
      await this.writeStaged(stagingDir, file.path, content);
    }
    return metadata.tree;
  }

  private async stageDelta(
    manifest: RendererManifest,
    delta: RendererDelta,
    stagingDir: string,
    byHash: Map<string, string>,
    rendererUrl: string,
  ): Promise<RendererTreeFile[]> {
    const { entries, metadata } = await this.fetchPack(rendererUrl, delta.pack, {
      fromVersion: delta.fromVersion,
      kind: 'delta',
      version: manifest.version,
    });
    if (metadata.kind !== 'delta') throw new Error('Delta pack metadata mismatch');
    if (!canApplyDelta(metadata, byHash)) throw new Error('Delta base content is incomplete');
    const objects = new Set(metadata.objects);
    const patches = new Map(metadata.patches.map((patch) => [patch.toSha256, patch]));

    for (const file of metadata.tree) {
      const localPath = byHash.get(file.sha256);
      if (localPath) {
        await this.placeLocalFile(localPath, path.join(stagingDir, file.path));
        continue;
      }

      if (objects.has(file.sha256)) {
        const content = entries.get(`objects/${file.sha256}`);
        if (!content) throw new Error(`Delta pack missing full object ${file.path}`);
        await this.writeStaged(stagingDir, file.path, content);
        continue;
      }

      const patch = patches.get(file.sha256);
      const basePath = patch && byHash.get(patch.fromSha256);
      const patchContent = patch && entries.get(`patches/${patch.patchSha256}`);
      if (!patch || !basePath || !patchContent) {
        throw new Error(`Delta cannot reconstruct ${file.path}`);
      }
      const next = await applyZstdPatch(await readFile(basePath), patchContent);
      await this.writeStaged(stagingDir, file.path, next);
    }
    return metadata.tree;
  }

  private async placeLocalFile(localPath: string, target: string) {
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await link(localPath, target);
    } catch {
      await copyFile(localPath, target);
    }
  }

  private async writeStaged(stagingDir: string, relPath: string, content: Buffer) {
    const target = path.join(stagingDir, relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  private async fetchPack(
    rendererUrl: string,
    artifact: RendererArtifact,
    expected: Parameters<typeof decodeRendererPack>[1],
  ) {
    const res = await fetch(`${rendererUrl}/${artifact.path}`);
    if (!res.ok) throw new Error(`Renderer pack fetch failed (${res.status}): ${artifact.path}`);
    const content = Buffer.from(await res.arrayBuffer());
    if (content.byteLength !== artifact.size || sha256File(content) !== artifact.sha256) {
      throw new Error(`Renderer pack integrity mismatch: ${artifact.path}`);
    }
    return decodeRendererPack(content, expected);
  }

  private async hashLocalTree(otaDir: string, pointer: OtaPointer): Promise<Map<string, string>> {
    const root = pointer.current ? path.join(otaDir, 'versions', pointer.current) : rendererDir;
    const hashes = new Map<string, string>();

    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else hashes.set(full, sha256File(await readFile(full)));
      }
    };
    await walk(root);
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
        browser.browserWindow.webContents.reloadIgnoringCache();
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
