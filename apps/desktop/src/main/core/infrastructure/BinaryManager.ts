import { exec, execFile, type ExecFileOptions, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import { app } from 'electron';

import type { App } from '@/core/App';
import { createLogger } from '@/utils/logger';

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);
const logger = createLogger('core:BinaryManager');

/**
 * Where on the host a binary resolution came from. Lets the UI tell the user
 * that the system-wide install is in use, vs the version this app downloaded
 * into its own cache.
 */
export type BinarySource = 'system' | 'managed';

/**
 * Status of a registered binary on the host.
 */
export interface BinaryStatus {
  available: boolean;
  error?: string;
  lastChecked?: Date;
  /**
   * Whether the spec opts into the manager's install/upgrade lifecycle. The UI
   * uses this to know when to surface an Install / Update button next to an
   * unavailable binary.
   */
  manageable?: boolean;
  path?: string;
  /**
   * PATH value used to resolve/validate the command, surfaced only when it
   * differs from the detector process's `process.env.PATH` (e.g. resolution
   * fell back to the login-shell PATH). A caller that spawns the resolved
   * `path` must carry this into the child's PATH, or a `#!/usr/bin/env node`
   * shim that resolved here still fails with `env: node: No such file or
   * directory` under the leaner inherited env.
   */
  resolvedPathEnv?: string;
  /** Where the resolved binary lives — system PATH or the manager's cache. */
  source?: BinarySource;
  version?: string;
}

/**
 * Context passed to `BinaryManageSpec.release` when computing a download URL.
 */
export interface BinaryReleaseContext {
  arch: NodeJS.Architecture;
  platform: NodeJS.Platform;
  version: string;
}

/**
 * Optional install/upgrade lifecycle for a binary. When present, the manager
 * can lazily download the binary into `userData/bin/<name>/<version>/` on
 * first use, strip macOS quarantine, and run post-install steps.
 */
export interface BinaryManageSpec {
  /**
   * Optional override to fetch the latest version string (e.g. via GitHub
   * releases API). Defaults to GitHub `releases/latest` when `githubRepo`
   * is set, otherwise the manager requires `pinnedVersion`.
   */
  fetchLatestVersion?: () => Promise<string>;
  /**
   * GitHub `owner/repo` slug — used by the default `fetchLatestVersion` and
   * surfaced in logs for diagnostics.
   */
  githubRepo?: string;
  /**
   * macOS Gatekeeper quarantine handling for the downloaded binary.
   * - `strip` (default): remove `com.apple.quarantine` xattr.
   * - `none`: leave the binary alone.
   */
  macosQuarantine?: 'strip' | 'none';
  /** Pinned version, used when `fetchLatestVersion` is not provided. */
  pinnedVersion?: string;
  /**
   * Commands to run against the freshly installed binary, e.g. `['install']`
   * so `agent-browser install` pulls Chrome on first set-up. Each entry is
   * an `argv` array passed to `execFile(<installedPath>, args)`.
   */
  postInstall?: string[][];
  /**
   * Build the release artifact URL for `(version, platform, arch)`. The
   * returned URL must end in a downloadable file — redirects are followed.
   */
  release: (ctx: BinaryReleaseContext) => string;
}

/**
 * Specification for a binary the desktop app knows about — modules implement
 * this to register detection (and optional install/upgrade) logic.
 */
export interface BinarySpec {
  /** Human-readable description */
  description?: string;
  /** Detection method */
  detect: () => Promise<BinaryStatus>;
  /** Optional install/upgrade lifecycle */
  manage?: BinaryManageSpec;
  /** Binary name, e.g., 'rg', 'mdfind', 'agent-browser' */
  name: string;
  /** Priority within category, lower number = higher priority */
  priority?: number;
}

/**
 * Binary categories
 */
export type BinaryCategory =
  | 'content-search'
  | 'ast-search'
  | 'file-search'
  | 'browser-automation'
  | 'runtime-environment'
  | 'cli-agents'
  | 'system'
  | 'custom';

/**
 * Binary Manager
 *
 * A plugin-style manager for binaries the desktop app cares about — handles
 * detection plus an optional install / upgrade lifecycle for binaries the
 * app ships with. Modules register their own specs and query status.
 *
 * @example
 * ```typescript
 * manager.register({
 *   name: 'agent-browser',
 *   detect: ...,
 *   manage: {
 *     pinnedVersion: '0.31.1',
 *     release: ({ version, platform, arch }) =>
 *       `https://github.com/vercel-labs/agent-browser/releases/download/v${version}/agent-browser-${platform}-${arch}`,
 *     postInstall: [['install']],
 *   },
 * }, 'browser-automation');
 *
 * const binPath = await manager.ensure('agent-browser'); // downloads if missing
 * ```
 */
export class BinaryManager {
  private app: App;
  private specs = new Map<string, BinarySpec>();
  private statusCache = new Map<string, BinaryStatus>();
  private categoryMap = new Map<BinaryCategory, Set<string>>();
  /** De-dupe concurrent ensure() / install() calls per binary name. */
  private inFlight = new Map<string, Promise<string>>();
  private _cacheRoot: string | undefined;

  constructor(app: App) {
    logger.debug('Initializing BinaryManager');
    this.app = app;
  }

  /**
   * Resolve the per-user binary cache root lazily — `app.getPath('userData')`
   * isn't usable at import time, only after the Electron app is initialized.
   */
  private get cacheRoot(): string {
    if (!this._cacheRoot) {
      this._cacheRoot = path.join(app.getPath('userData'), 'bin');
    }
    return this._cacheRoot;
  }

  /**
   * Register a binary spec
   * @param spec The spec to register
   * @param category Binary category for grouping
   */
  register(spec: BinarySpec, category: BinaryCategory = 'custom'): void {
    const { name } = spec;

    if (this.specs.has(name)) {
      logger.warn(`Spec for '${name}' already registered, overwriting`);
    }

    this.specs.set(name, spec);

    if (!this.categoryMap.has(category)) {
      this.categoryMap.set(category, new Set());
    }
    this.categoryMap.get(category)!.add(name);

    logger.debug(
      `Registered spec: ${name} (category: ${category}, priority: ${spec.priority ?? 'default'}, manageable: ${Boolean(spec.manage)})`,
    );
  }

  /**
   * Unregister a binary spec
   * @param name Binary name to unregister
   */
  unregister(name: string): boolean {
    if (!this.specs.has(name)) {
      return false;
    }

    this.specs.delete(name);
    this.statusCache.delete(name);

    for (const names of this.categoryMap.values()) {
      names.delete(name);
    }

    logger.debug(`Unregistered spec: ${name}`);
    return true;
  }

  /**
   * Detect a single binary. Checks the manager's own cache first so a
   * previously-installed managed copy wins over a stale `which` result.
   * @param name Binary name
   * @param force Force detection, bypass cache
   */
  async detect(name: string, force = false): Promise<BinaryStatus> {
    const spec = this.specs.get(name);
    if (!spec) {
      return {
        available: false,
        error: `No spec registered for '${name}'`,
      };
    }

    if (!force && this.statusCache.has(name)) {
      return this.statusCache.get(name)!;
    }

    const manageable = Boolean(spec.manage);

    // Managed install wins: if we previously downloaded a copy, surface it
    // directly. Avoids the cycle of installing-then-detect-not-seeing-it.
    const managedPath = await this.findManagedPath(name);
    if (managedPath) {
      const version = await this.readInstalledVersion(name);
      const status: BinaryStatus = {
        available: true,
        lastChecked: new Date(),
        manageable,
        path: managedPath,
        source: 'managed',
        version: version ?? undefined,
      };
      this.statusCache.set(name, status);
      return status;
    }

    try {
      logger.debug(`Detecting binary: ${name}`);
      const detected = await spec.detect();
      const status: BinaryStatus = {
        ...detected,
        lastChecked: new Date(),
        manageable,
        source: detected.available ? 'system' : undefined,
      };
      this.statusCache.set(name, status);

      logger.debug(`Binary ${name} detection result:`, {
        available: status.available,
        path: status.path,
        source: status.source,
        version: status.version,
      });

      return status;
    } catch (error) {
      const status: BinaryStatus = {
        available: false,
        error: (error as Error).message,
        lastChecked: new Date(),
        manageable,
      };
      this.statusCache.set(name, status);
      logger.error(`Error detecting binary ${name}:`, error);
      return status;
    }
  }

  /**
   * Detect all registered binaries
   * @param force Force detection, bypass cache
   */
  async detectAll(force = false): Promise<Map<string, BinaryStatus>> {
    const results = new Map<string, BinaryStatus>();

    await Promise.all(
      Array.from(this.specs.keys()).map(async (name) => {
        const status = await this.detect(name, force);
        results.set(name, status);
      }),
    );

    return results;
  }

  /**
   * Detect all binaries in a category
   * @param category Binary category
   * @param force Force detection, bypass cache
   */
  async detectCategory(
    category: BinaryCategory,
    force = false,
  ): Promise<Map<string, BinaryStatus>> {
    const names = this.categoryMap.get(category);
    if (!names) {
      return new Map();
    }

    const results = new Map<string, BinaryStatus>();

    await Promise.all(
      Array.from(names).map(async (name) => {
        const status = await this.detect(name, force);
        results.set(name, status);
      }),
    );

    return results;
  }

  /**
   * Get cached status for a binary
   * @param name Binary name
   */
  getStatus(name: string): BinaryStatus | undefined {
    return this.statusCache.get(name);
  }

  /**
   * Get all cached statuses
   */
  getAllStatus(): Map<string, BinaryStatus> {
    return new Map(this.statusCache);
  }

  /**
   * Get the best available binary in a category. Method name kept verbatim
   * so it satisfies the `ToolDetector` contract in `@lobechat/local-file-shell`
   * (which the content/file search impls inject).
   * @param category Binary category
   */
  async getBestTool(category: BinaryCategory): Promise<string | null> {
    const names = this.categoryMap.get(category);
    if (!names || names.size === 0) {
      return null;
    }

    const sortedSpecs = Array.from(names)
      .map((name) => this.specs.get(name)!)
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    for (const spec of sortedSpecs) {
      const status = await this.detect(spec.name);
      if (status.available) {
        return spec.name;
      }
    }

    return null;
  }

  /**
   * Get all binaries in a category, sorted by priority
   * @param category Binary category
   */
  getInCategory(category: BinaryCategory): BinarySpec[] {
    const names = this.categoryMap.get(category);
    if (!names) {
      return [];
    }

    return Array.from(names)
      .map((name) => this.specs.get(name)!)
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Clear status cache
   * @param name Optional binary name; if not provided, clears all
   */
  clearCache(name?: string): void {
    if (name) {
      this.statusCache.delete(name);
      logger.debug(`Cleared cache for: ${name}`);
    } else {
      this.statusCache.clear();
      logger.debug('Cleared all cache');
    }
  }

  /**
   * Get all registered binary names
   */
  getRegistered(): string[] {
    return Array.from(this.specs.keys());
  }

  /**
   * Get all categories
   */
  getCategories(): BinaryCategory[] {
    return Array.from(this.categoryMap.keys());
  }

  /**
   * Check if a binary is registered
   */
  isRegistered(name: string): boolean {
    return this.specs.has(name);
  }

  // ====================================================================
  // PATH integration
  // ====================================================================

  /**
   * Walk over registered specs and append each currently-installed managed
   * binary's directory to `process.env.PATH`. Idempotent — a directory is
   * never appended twice. Call once at bootstrap so shells spawned by child
   * agents can resolve managed binaries without going through the manager.
   */
  async augmentPath(): Promise<void> {
    for (const name of this.specs.keys()) {
      const managedPath = await this.findManagedPath(name);
      if (managedPath) {
        this.appendToPath(path.dirname(managedPath));
      }
    }
  }

  /** Append `dir` to PATH if not already present. */
  private appendToPath(dir: string): void {
    const sep = process.platform === 'win32' ? ';' : ':';
    const current = process.env.PATH ?? '';
    const parts = current.split(sep);
    if (parts.includes(dir)) return;
    process.env.PATH = current ? `${current}${sep}${dir}` : dir;
    logger.debug(`Appended to PATH: ${dir}`);
  }

  // ====================================================================
  // Lifecycle: install / upgrade / ensure
  // ====================================================================

  /**
   * Ensure a binary is available, downloading the managed copy on demand if
   * the host doesn't already have it. Returns the absolute executable path.
   * Throws when the binary is unmanageable AND not on the system PATH.
   *
   * Concurrent calls for the same name share a single in-flight install.
   */
  async ensure(name: string): Promise<string> {
    const inflight = this.inFlight.get(name);
    if (inflight) return inflight;

    const task = this._ensure(name).finally(() => {
      this.inFlight.delete(name);
    });
    this.inFlight.set(name, task);
    return task;
  }

  private async _ensure(name: string): Promise<string> {
    const spec = this.specs.get(name);
    if (!spec) throw new Error(`BinaryManager: no spec registered for '${name}'`);

    // Existing managed install wins — keeps a previously-downloaded copy
    // from being re-detected as "system" via PATH lookup.
    const managedPath = await this.findManagedPath(name);
    if (managedPath) return managedPath;

    // System install on PATH satisfies the request without managed install.
    const status = await this.detect(name, true);
    if (status.available && status.path) return status.path;

    if (!spec.manage) {
      throw new Error(
        `Binary '${name}' is not available on the system PATH and does not opt into management. ` +
          `Install it manually or extend its BinarySpec with a 'manage' block.`,
      );
    }

    return this.install(name);
  }

  /**
   * Download (or re-download) the managed copy of a binary. When `version`
   * is omitted the spec's pinnedVersion is used, falling back to the latest
   * release. Use this directly to force an upgrade.
   */
  async install(name: string, version?: string): Promise<string> {
    const spec = this.specs.get(name);
    if (!spec?.manage) {
      throw new Error(`Binary '${name}' is not manageable`);
    }
    const manageSpec = spec.manage;

    const resolvedVersion =
      version ?? manageSpec.pinnedVersion ?? (await this.fetchLatestVersion(name));
    if (!resolvedVersion) {
      throw new Error(
        `Cannot resolve version for '${name}' — set 'pinnedVersion' or 'githubRepo' / 'fetchLatestVersion' on its manage spec.`,
      );
    }

    const releaseUrl = manageSpec.release({
      arch: process.arch,
      platform: process.platform,
      version: resolvedVersion,
    });

    const installDir = path.join(this.cacheRoot, name, resolvedVersion);
    const fileName = process.platform === 'win32' ? `${name}.exe` : name;
    const targetPath = path.join(installDir, fileName);

    await mkdir(installDir, { recursive: true });

    logger.info(`[${name}] downloading v${resolvedVersion} from ${releaseUrl}`);
    await downloadWithRedirects(releaseUrl, targetPath);

    const { size } = await stat(targetPath);
    logger.info(`[${name}] downloaded ${(size / 1024 / 1024).toFixed(1)} MB → ${targetPath}`);

    if (process.platform !== 'win32') {
      await chmod(targetPath, 0o755);
    }

    if (process.platform === 'darwin' && (manageSpec.macosQuarantine ?? 'strip') === 'strip') {
      await stripMacosQuarantine(targetPath);
    }

    // Atomically point the .installed marker at the new version so concurrent
    // readers either see the old or new version, never an empty file.
    const markerPath = this.installedMarkerPath(name);
    const tmpMarker = `${markerPath}.${process.pid}.tmp`;
    await writeFile(tmpMarker, resolvedVersion, 'utf8');
    await rm(markerPath, { force: true });
    await writeFile(markerPath, resolvedVersion, 'utf8');
    await rm(tmpMarker, { force: true });

    if (manageSpec.postInstall?.length) {
      for (const args of manageSpec.postInstall) {
        logger.info(`[${name}] post-install: ${args.join(' ')}`);
        try {
          await execFilePromise(targetPath, args, { timeout: 10 * 60 * 1000 } as ExecFileOptions);
        } catch (error) {
          logger.warn(`[${name}] post-install step failed:`, error);
        }
      }
    }

    // Invalidate the cached status so the next detect() reflects the new install.
    this.statusCache.delete(name);

    // Make the freshly installed binary immediately resolvable from PATH so
    // child processes spawned right after ensure() succeed without restart.
    this.appendToPath(installDir);

    return targetPath;
  }

  /**
   * Upgrade a managed binary to a specific version, or to the latest if
   * `version` is omitted. Returns the new installed path.
   */
  async upgrade(name: string, version?: string): Promise<string> {
    const spec = this.specs.get(name);
    if (!spec?.manage) throw new Error(`Binary '${name}' is not manageable`);

    const target =
      version ??
      (spec.manage.fetchLatestVersion || spec.manage.githubRepo
        ? await this.fetchLatestVersion(name)
        : undefined);

    if (!target) {
      throw new Error(
        `Cannot resolve upgrade version for '${name}' — pass a version or set 'githubRepo' / 'fetchLatestVersion'.`,
      );
    }

    const current = await this.readInstalledVersion(name);
    if (current === target) {
      logger.info(`[${name}] already at v${target}, skipping upgrade`);
      const existing = await this.findManagedPath(name);
      if (existing) return existing;
    }

    return this.install(name, target);
  }

  /**
   * Path to the currently-installed managed copy of `name`, or `null` if no
   * install marker exists or the marker points at a missing file.
   */
  async findManagedPath(name: string): Promise<string | null> {
    const version = await this.readInstalledVersion(name);
    if (!version) return null;
    const fileName = process.platform === 'win32' ? `${name}.exe` : name;
    const candidate = path.join(this.cacheRoot, name, version, fileName);
    try {
      await stat(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  /**
   * Currently-installed version recorded for `name`, or `null` if none.
   */
  async readInstalledVersion(name: string): Promise<string | null> {
    try {
      const raw = await readFile(this.installedMarkerPath(name), 'utf8');
      const trimmed = raw.trim();
      return trimmed || null;
    } catch {
      return null;
    }
  }

  private installedMarkerPath(name: string): string {
    return path.join(this.cacheRoot, name, '.installed');
  }

  private async fetchLatestVersion(name: string): Promise<string> {
    const spec = this.specs.get(name);
    if (!spec?.manage) throw new Error(`Binary '${name}' is not manageable`);

    if (spec.manage.fetchLatestVersion) {
      return spec.manage.fetchLatestVersion();
    }

    if (!spec.manage.githubRepo) {
      throw new Error(
        `Cannot fetch latest version for '${name}' — set 'githubRepo' or 'fetchLatestVersion' on its manage spec.`,
      );
    }

    const tag = await fetchGithubLatestTag(spec.manage.githubRepo);
    return tag.replace(/^v/, '');
  }
}

// ========================================
// Helper: define a command-based binary spec
// ========================================

/**
 * Define a simple command-based binary spec — detects via `which`/`where`
 * and optionally reads `--version`. Useful for tools that follow the standard
 * "on PATH or not" pattern.
 */
export function defineCommandBinary(
  name: string,
  options: {
    description?: string;
    manage?: BinaryManageSpec;
    priority?: number;
    versionFlag?: string;
    whichCommand?: string;
  } = {},
): BinarySpec {
  const { description, manage, priority, versionFlag = '--version', whichCommand } = options;

  return {
    description,
    async detect(): Promise<BinaryStatus> {
      try {
        const whichCmd = whichCommand || (process.platform === 'win32' ? 'where' : 'which');
        const { stdout: pathOut } = await execPromise(`${whichCmd} ${name}`, { timeout: 3000 });
        const toolPath = pathOut.trim().split('\n')[0];

        let version: string | undefined;
        try {
          const { stdout: versionOut } = await execPromise(`${name} ${versionFlag}`, {
            timeout: 3000,
          });
          version = versionOut.trim().split('\n')[0];
        } catch {
          // Some binaries don't support a version flag
        }

        return {
          available: true,
          path: toolPath,
          version,
        };
      } catch {
        return {
          available: false,
        };
      }
    },
    manage,
    name,
    priority,
  };
}

// ========================================
// Internal helpers — download + Gatekeeper handling
// ========================================

/**
 * Follow HTTP(S) redirects and stream the body to `dest`. Mirrors the older
 * `scripts/download-agent-browser.mjs` semantics — 5 hops max, errors on
 * non-2xx, no checksum verification (left to the spec when needed).
 */
async function downloadWithRedirects(url: string, dest: string, maxRedirects = 5): Promise<void> {
  if (maxRedirects <= 0) throw new Error('Too many redirects while downloading binary');

  await new Promise<void>((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'lobehub-desktop-binary-manager' } }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const next = res.headers.location;
          res.resume();
          downloadWithRedirects(next, dest, maxRedirects - 1).then(resolve, reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed: HTTP ${res.statusCode} from ${url}`));
          return;
        }

        const file = createWriteStream(dest);
        pipeline(res, file).then(resolve, reject);
      })
      .on('error', reject);
  });
}

/**
 * Strip the `com.apple.quarantine` xattr from a freshly downloaded binary on
 * macOS so Gatekeeper doesn't refuse to exec ad-hoc signed artifacts. No-op
 * (silent) on every other platform, or when no quarantine attribute exists.
 */
async function stripMacosQuarantine(filePath: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn('xattr', ['-d', 'com.apple.quarantine', filePath], {
      stdio: 'ignore',
    });
    child.on('error', () => resolve());
    child.on('exit', () => resolve());
  });
}

/**
 * Look up the most recent release tag for `owner/repo`. Uses the unauthenticated
 * GitHub API; intended for occasional version-check calls, not hot loops.
 */
async function fetchGithubLatestTag(repo: string): Promise<string> {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  return new Promise<string>((resolve, reject) => {
    https
      .get(
        apiUrl,
        {
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'lobehub-desktop-binary-manager',
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`GitHub release lookup failed for ${repo}: HTTP ${res.statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                tag_name?: string;
              };
              if (!body.tag_name) {
                reject(new Error(`GitHub release lookup for ${repo} returned no tag_name`));
                return;
              }
              resolve(body.tag_name);
            } catch (error) {
              reject(error as Error);
            }
          });
          res.on('error', reject);
        },
      )
      .on('error', reject);
  });
}
