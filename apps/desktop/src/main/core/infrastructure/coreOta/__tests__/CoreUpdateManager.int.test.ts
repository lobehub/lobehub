import { generateKeyPairSync, sign } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';

import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShellGlobal } from '@/const/shell';

import { canonicalJson, type CoreManifest, sha256File } from '../manifest';
import { readPointer, writePointer } from '../pointer';
import { SAFE_VERSION } from '../store';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const ABI = 'a'.repeat(64);
const SERVER = 'https://updates.test';
const OBJECTS = 'https://cdn.test/cas';
const PLATFORM = process.platform as CoreManifest['platform'];

const BASE_FILES: Record<string, string> = {
  'dist/main/index.js': 'main-v1',
  'dist/renderer/apps/desktop/index.html': '<script src="/assets/index.js"></script>',
  'dist/renderer/apps/desktop/overlay.html': '<script src="/assets/overlay.js"></script>',
  'dist/renderer/apps/desktop/popup.html': '<script src="/assets/popup.js"></script>',
  'dist/renderer/assets/index.js': 'index-v1',
  'dist/renderer/assets/overlay.js': 'overlay',
  'dist/renderer/assets/popup.js': 'popup',
  'package.json': '{"main":"dist/main/index.js"}',
};

let userDataDir: string;
let builtinDir: string;
let served: Map<string, Buffer>;

const { electronMock, loggerMock } = vi.hoisted(() => ({
  electronMock: {
    app: {
      getPath: vi.fn(),
      on: vi.fn(),
      quit: vi.fn(),
      relaunch: vi.fn(),
      releaseSingleInstanceLock: vi.fn(),
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    net: { fetch: vi.fn() },
  },
  loggerMock: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({ createLogger: () => loggerMock }));
vi.mock('electron', () => electronMock);
vi.mock('@/modules/updater/configs', () => ({
  BUILD_CHANNEL: 'stable',
  UPDATE_CHANNEL: 'stable',
  UPDATE_SERVER_URL: 'https://updates.test/stable',
  coerceStoredUpdateChannel: (channel?: string) => (channel === 'canary' ? 'canary' : 'stable'),
}));

const makeApp = () => ({
  browserManager: {
    broadcastToAllWindows: vi.fn(),
    browsers: new Map([
      ['main', { browserWindow: { webContents: { reloadIgnoringCache: vi.fn() } } }],
    ]),
  },
  isQuiting: false,
  rendererUrlManager: {
    activeDir: null as string | null,
    getActiveRendererDir() {
      return this.activeDir;
    },
    setActiveRendererDir: vi.fn(function (this: { activeDir: string | null }, dir: string | null) {
      this.activeDir = dir;
    }),
  },
  storeManager: { get: vi.fn(() => 'stable') },
  updaterManager: { captureRestoreRoute: vi.fn() },
});

const signManifest = (unsigned: Omit<CoreManifest, 'signature'>): CoreManifest => ({
  ...unsigned,
  signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64'),
});

const zst = (content: Buffer) =>
  zstdCompressSync(content, { params: { [constants.ZSTD_c_compressionLevel]: 3 } });

const buildManifest = (
  version: string,
  seq: number,
  files: Record<string, string>,
  overrides: Partial<Omit<CoreManifest, 'signature'>> = {},
): CoreManifest => {
  const objects = new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)] as const));
  const tree = [...objects]
    .map(([p, content]) => ({ path: p, sha256: sha256File(content), size: content.length }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const zippable: Record<string, Uint8Array> = {};
  for (const [, content] of objects) zippable[`objects/${sha256File(content)}`] = content;
  const pack = Buffer.from(zipSync(zippable));
  const packSha = sha256File(pack);
  served.set(`${SERVER}/stable/core/${PLATFORM}/packs/${packSha}.zip`, pack);
  for (const [, content] of objects) {
    served.set(`${OBJECTS}/objects/${sha256File(content)}.zst`, zst(content));
  }
  return signManifest({
    applyMode: null,
    channel: 'stable',
    full: { path: `packs/${packSha}.zip`, sha256: packSha, size: pack.length },
    objectsBaseUrl: OBJECTS,
    patches: [],
    platform: PLATFORM,
    previous: null,
    rollout: 1,
    schemaVersion: 3,
    seq,
    shellAbi: ABI,
    tree,
    version,
    ...overrides,
  });
};

const materialize = (dir: string, files: Record<string, string>, manifest: CoreManifest) => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), c);
  }
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
};

const serveLatest = (manifest: CoreManifest | null) => {
  const url = `${SERVER}/stable/core/${PLATFORM}/latest.json`;
  if (manifest) served.set(url, Buffer.from(JSON.stringify(manifest)));
  else served.delete(url);
};

const fetchImpl = vi.fn(async (url: string) =>
  served.has(url)
    ? new Response(new Uint8Array(served.get(url)!))
    : new Response('nope', { status: 404 }),
);

const otaRoot = () => path.join(userDataDir, 'core-ota');
const storeDir = () => path.join(otaRoot(), 'store');
const pointerAt = (patch: Partial<ReturnType<typeof readPointer>>) =>
  writePointer(otaRoot(), {
    abi: ABI,
    blacklist: [],
    channel: 'stable',
    current: null,
    previous: null,
    staged: null,
    ...patch,
  });
const coreDir = (version: string) => path.join(otaRoot(), 'cores', version);

const makeShell = (overrides: Partial<ShellGlobal> = {}): ShellGlobal => ({
  abi: ABI,
  builtinDir,
  coreDir: builtinDir,
  log: [],
  manifest: builtinManifest,
  markHealthy: () => {},
  publicKey: PUBLIC_KEY_PEM,
  shellVersion: '1.0.0',
  source: 'builtin',
  ...overrides,
});

const loadManager = async (app = makeApp(), shell: ShellGlobal | null = makeShell()) => {
  vi.resetModules();
  const { CoreUpdateManager } = await import('../CoreUpdateManager');
  const manager = new CoreUpdateManager(app as never, { fetchImpl, shell: shell ?? undefined });
  manager.initialize();
  return { app, manager };
};

const flushGc = () => new Promise((resolve) => setTimeout(resolve, 20));

let builtinManifest: CoreManifest;

beforeEach(() => {
  vi.clearAllMocks();
  served = new Map();
  userDataDir = mkdtempSync(path.join(tmpdir(), 'core-ota-user-'));
  builtinDir = mkdtempSync(path.join(tmpdir(), 'core-ota-builtin-'));
  electronMock.app.getPath.mockReturnValue(userDataDir);
  builtinManifest = buildManifest('1.0.0', 0, BASE_FILES);
  materialize(builtinDir, BASE_FILES, builtinManifest);
});

afterEach(() => {
  rmSync(userDataDir, { force: true, recursive: true });
  rmSync(builtinDir, { force: true, recursive: true });
});

const rendererOnly = (version: string, seq: number) =>
  buildManifest(version, seq, {
    ...BASE_FILES,
    'dist/renderer/assets/index.js': `index-${version}`,
  });

const mainChanged = (version: string, seq: number) =>
  buildManifest(version, seq, { ...BASE_FILES, 'dist/main/index.js': `main-${version}` });

describe('CoreUpdateManager initialize', () => {
  it('reports disabled reasons when shell is missing', async () => {
    const { manager } = await loadManager(makeApp(), null);
    expect(manager.enabled).toBe(false);
    expect(manager.disabledReasons).toEqual(['missing-shell']);
  });

  it('reports disabled reasons when public key is missing', async () => {
    const { manager } = await loadManager(makeApp(), makeShell({ publicKey: '' }));
    expect(manager.disabledReasons).toEqual(['missing-public-key']);
  });

  it('resets pointer and clears cores when abi changed', async () => {
    mkdirSync(coreDir('0.9.0'), { recursive: true });
    writePointer(otaRoot(), {
      abi: 'b'.repeat(64),
      blacklist: ['0.8.0'],
      channel: 'stable',
      current: '0.9.0',
      previous: null,
      staged: null,
    });

    const { manager } = await loadManager();
    await flushGc();

    expect(manager.getStatus().current).toBeNull();
    expect(readPointer(otaRoot(), ABI)).toMatchObject({ blacklist: [], current: null });
    expect(existsSync(coreDir('0.9.0'))).toBe(false);
  });

  it('keeps store objects across an abi reset', async () => {
    mkdirSync(storeDir(), { recursive: true });
    writeFileSync(path.join(storeDir(), 'f'.repeat(64)), 'blob');
    pointerAt({ abi: 'b'.repeat(64) } as never);

    await loadManager();
    await flushGc();

    expect(existsSync(path.join(storeDir(), 'f'.repeat(64)))).toBe(true);
  });

  it('clears pointer.current when the shell fell back to builtin and the core dir is gone', async () => {
    pointerAt({ current: '1.0.1', previous: '0.9.0' });

    const { manager } = await loadManager();

    expect(readPointer(otaRoot(), ABI)).toMatchObject({
      blacklist: [],
      current: null,
      previous: null,
    });
    serveLatest(rendererOnly('1.0.1', 1));
    await manager.checkForUpdates();
    expect(manager.getStatus().staged).toBe('1.0.1');
  });

  it('blacklists pointer.current when the shell rejected a core that still exists', async () => {
    const v1 = rendererOnly('1.0.1', 1);
    materialize(coreDir('1.0.1'), BASE_FILES, v1);
    pointerAt({ current: '1.0.1' });

    await loadManager();

    expect(readPointer(otaRoot(), ABI)).toMatchObject({ blacklist: ['1.0.1'], current: null });
  });

  it('realigns pointer.current with the running external core', async () => {
    const v1Files = { ...BASE_FILES, 'dist/renderer/assets/index.js': 'index-1.0.1' };
    const v1 = buildManifest('1.0.1', 1, v1Files);
    materialize(coreDir('1.0.1'), v1Files, v1);
    pointerAt({ current: '1.0.2', previous: '1.0.1' });

    await loadManager(
      makeApp(),
      makeShell({ coreDir: coreDir('1.0.1'), manifest: v1, source: 'external' }),
    );

    expect(readPointer(otaRoot(), ABI)).toMatchObject({ current: '1.0.1', previous: null });
  });

  it('shares the version-name rule with the shell loader', () => {
    const loader = readFileSync(
      path.join(__dirname, '../../../../../../shell/core-loader.js'),
      'utf8',
    );
    expect(loader).toContain(`const VERSION_NAME = ${SAFE_VERSION};`);
  });

  describe('cold-boot check for an external core', () => {
    const bootExternal = async (bootJson: unknown) => {
      const v1Files = { ...BASE_FILES, 'dist/renderer/assets/index.js': 'index-1.0.1' };
      const v1 = buildManifest('1.0.1', 1, v1Files);
      materialize(coreDir('1.0.1'), v1Files, v1);
      pointerAt({ current: '1.0.1', previous: null });
      writeFileSync(path.join(otaRoot(), 'boot.json'), JSON.stringify(bootJson));
      return loadManager(
        makeApp(),
        makeShell({ coreDir: coreDir('1.0.1'), manifest: v1, source: 'external' }),
      );
    };

    it('rolls back and relaunches when the first boot of a version never mounts', async () => {
      vi.useFakeTimers();
      try {
        const { app, manager } = await bootExternal({ failures: 1, version: '1.0.1' });
        manager.startScheduledChecks();

        vi.advanceTimersByTime(30_000);
        expect(electronMock.app.relaunch).not.toHaveBeenCalled();
        vi.advanceTimersByTime(31_000);

        expect(readPointer(otaRoot(), ABI)).toMatchObject({ blacklist: ['1.0.1'], current: null });
        expect(electronMock.app.relaunch).toHaveBeenCalled();
        expect(app.rendererUrlManager.setActiveRendererDir).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not arm when the renderer already mounted before scheduling', async () => {
      vi.useFakeTimers();
      try {
        const { manager } = await bootExternal({ failures: 1, version: '1.0.1' });
        manager.handleBootPing('mounted');
        manager.startScheduledChecks();

        vi.advanceTimersByTime(120_000);

        expect(electronMock.app.relaunch).not.toHaveBeenCalled();
        expect(readPointer(otaRoot(), ABI).blacklist).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not arm on later boots of an already-confirmed version', async () => {
      vi.useFakeTimers();
      try {
        const { manager } = await bootExternal({ failures: 1, healthy: true, version: '1.0.1' });
        manager.startScheduledChecks();

        vi.advanceTimersByTime(120_000);

        expect(electronMock.app.relaunch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('CoreUpdateManager checkForUpdates', () => {
  it('is up-to-date when remote seq does not increase', async () => {
    serveLatest(rendererOnly('1.0.1', 0));
    const { app, manager } = await loadManager();

    await manager.checkForUpdates();

    expect(manager.getStatus().staged).toBeNull();
    expect(app.browserManager.broadcastToAllWindows).not.toHaveBeenCalled();
    expect(existsSync(coreDir('1.0.1'))).toBe(false);
  });

  it('stages a lower-seq core from the newly selected channel', async () => {
    const canary = buildManifest('1.0.1', 0, BASE_FILES, { channel: 'canary' });
    materialize(coreDir('1.0.1'), BASE_FILES, canary);
    pointerAt({ channel: 'canary', current: '1.0.1' });
    const { manager } = await loadManager(
      makeApp(),
      makeShell({
        coreDir: coreDir('1.0.1'),
        manifest: { ...canary, seq: 300 },
        source: 'external',
      }),
    );
    serveLatest(rendererOnly('1.0.2', 20));

    manager.switchChannel('stable');
    await manager.checkForUpdates();

    expect(manager.getStatus().staged).toBe('1.0.2');
    expect(readPointer(otaRoot(), ABI).channel).toBe('stable');
  });

  it('rejects a manifest with a bad signature', async () => {
    serveLatest({ ...rendererOnly('1.0.1', 1), signature: Buffer.from('bad').toString('base64') });
    const { manager } = await loadManager();

    await manager.checkForUpdates();

    expect(manager.getStatus()).toMatchObject({
      lastError: 'Manifest signature invalid',
      staged: null,
    });
  });

  it.each([
    ['channel', { channel: 'canary' as const }, 'Manifest channel mismatch'],
    [
      'platform',
      { platform: PLATFORM === 'win32' ? 'linux' : 'win32' } as const,
      'Manifest platform mismatch',
    ],
  ])('rejects a %s mismatch', async (_label, overrides, message) => {
    serveLatest(
      buildManifest('1.0.1', 1, { ...BASE_FILES, 'dist/renderer/assets/index.js': 'x' }, overrides),
    );
    const { manager } = await loadManager();

    await manager.checkForUpdates();

    expect(manager.getStatus()).toMatchObject({ lastError: message, staged: null });
  });

  it('flags needsFullRelease when shell abi differs', async () => {
    serveLatest(buildManifest('1.0.1', 1, BASE_FILES, { shellAbi: 'c'.repeat(64) }));
    const { manager } = await loadManager();

    await manager.checkForUpdates();

    expect(manager.getStatus()).toMatchObject({ needsFullRelease: true, staged: null });
    expect(existsSync(coreDir('1.0.1'))).toBe(false);
  });

  it('stages a renderer-only update as core-reload and applies it in place', async () => {
    const remote = rendererOnly('1.0.1', 1);
    serveLatest(remote);
    const { app, manager } = await loadManager();
    app.rendererUrlManager.activeDir = path.join(builtinDir, 'dist/renderer');

    await manager.checkForUpdates();

    expect(manager.getStatus()).toMatchObject({ applyMode: 'reload', staged: '1.0.1' });
    expect(app.browserManager.broadcastToAllWindows).toHaveBeenCalledWith('updateReady', {
      kind: 'core-reload',
      version: '1.0.1',
    });
    expect(readPointer(otaRoot(), ABI)).toMatchObject({ current: null, staged: '1.0.1' });
    expect(existsSync(path.join(coreDir('1.0.1'), 'dist/renderer/assets/index.js'))).toBe(true);

    expect(manager.applyStagedNow()).toBe(true);

    expect(app.rendererUrlManager.setActiveRendererDir).toHaveBeenCalledWith(
      path.join(coreDir('1.0.1'), 'dist/renderer'),
    );
    expect(readPointer(otaRoot(), ABI)).toMatchObject({
      current: '1.0.1',
      previous: null,
      staged: null,
    });
    expect(manager.getStatus().staged).toBeNull();
    const reload =
      app.browserManager.browsers.get('main')!.browserWindow.webContents.reloadIgnoringCache;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stages a main-process change as core-relaunch and switches pointer immediately', async () => {
    serveLatest(mainChanged('1.0.1', 1));
    const { app, manager } = await loadManager();

    await manager.checkForUpdates();

    expect(manager.getStatus()).toMatchObject({ applyMode: 'relaunch', staged: '1.0.1' });
    expect(app.browserManager.broadcastToAllWindows).toHaveBeenCalledWith('updateReady', {
      kind: 'core-relaunch',
      version: '1.0.1',
    });
    expect(readPointer(otaRoot(), ABI)).toMatchObject({
      current: '1.0.1',
      previous: null,
      staged: null,
    });

    expect(manager.applyStagedNow()).toBe(true);

    expect(app.updaterManager.captureRestoreRoute).toHaveBeenCalled();
    expect(app.isQuiting).toBe(true);
    expect(electronMock.app.releaseSingleInstanceLock).toHaveBeenCalled();
    expect(electronMock.app.relaunch).toHaveBeenCalled();
    expect(electronMock.app.quit).toHaveBeenCalled();
    expect(app.rendererUrlManager.setActiveRendererDir).not.toHaveBeenCalled();
  });

  it('rolls back and blacklists the version when the boot check fails', async () => {
    serveLatest(rendererOnly('1.0.1', 1));
    const { app, manager } = await loadManager();
    const builtinRenderer = path.join(builtinDir, 'dist/renderer');
    app.rendererUrlManager.activeDir = builtinRenderer;
    await manager.checkForUpdates();
    manager.applyStagedNow();

    manager.handleRendererCrash();
    manager.handleRendererCrash();

    expect(app.rendererUrlManager.activeDir).toBe(builtinRenderer);
    expect(readPointer(otaRoot(), ABI)).toMatchObject({
      blacklist: ['1.0.1'],
      current: null,
      previous: null,
    });
    const reload =
      app.browserManager.browsers.get('main')!.browserWindow.webContents.reloadIgnoringCache;
    expect(reload).toHaveBeenCalledTimes(2);

    fetchImpl.mockClear();
    await manager.checkForUpdates();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().staged).toBeNull();
  });

  it('clears the boot check on a successful ping', async () => {
    serveLatest(rendererOnly('1.0.1', 1));
    const { manager } = await loadManager();
    await manager.checkForUpdates();
    manager.applyStagedNow();

    manager.handleBootPing('loaded');
    manager.handleBootPing('mounted');
    manager.handleRendererCrash();
    manager.handleRendererCrash();

    expect(readPointer(otaRoot(), ABI)).toMatchObject({ blacklist: [], current: '1.0.1' });
  });

  it('skips versions excluded by rollout', async () => {
    serveLatest(buildManifest('1.0.1', 1, BASE_FILES, { rollout: 0 }));
    const { manager } = await loadManager();

    await manager.checkForUpdates();

    expect(manager.getStatus().staged).toBeNull();
    expect(existsSync(coreDir('1.0.1'))).toBe(false);
  });

  it('runs from an external core and keeps only current, previous and staged after gc', async () => {
    const v1Files = { ...BASE_FILES, 'dist/renderer/assets/index.js': 'index-1.0.1' };
    const v1 = buildManifest('1.0.1', 1, v1Files);
    materialize(coreDir('1.0.1'), v1Files, v1);
    for (const stale of ['0.9.0', '0.9.5']) mkdirSync(coreDir(stale), { recursive: true });
    writePointer(otaRoot(), {
      abi: ABI,
      blacklist: [],
      channel: 'stable',
      current: '1.0.1',
      previous: '0.9.5',
      staged: null,
    });
    serveLatest(rendererOnly('1.0.2', 2));

    const { manager } = await loadManager(
      makeApp(),
      makeShell({ coreDir: coreDir('1.0.1'), manifest: v1, source: 'external' }),
    );
    await flushGc();
    expect(readdirSync(path.join(otaRoot(), 'cores')).sort()).toEqual(['0.9.5', '1.0.1']);

    await manager.checkForUpdates();
    await flushGc();

    expect(manager.getStatus()).toMatchObject({ applyMode: 'reload', staged: '1.0.2' });
    expect(readPointer(otaRoot(), ABI)).toMatchObject({
      current: '1.0.1',
      previous: '0.9.5',
      staged: '1.0.2',
    });
    expect(readdirSync(path.join(otaRoot(), 'cores')).sort()).toEqual(['0.9.5', '1.0.1', '1.0.2']);
  });

  it('cancels the boot check instead of blacklisting when the renderer vetoes reload', async () => {
    vi.useFakeTimers();
    try {
      serveLatest(rendererOnly('1.0.1', 1));
      const { manager } = await loadManager();
      await manager.checkForUpdates();
      manager.applyStagedNow();

      manager.handleUnloadPrevented();
      vi.advanceTimersByTime(20_000);

      expect(readPointer(otaRoot(), ABI)).toMatchObject({ blacklist: [], current: '1.0.1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back on load timeout', async () => {
    vi.useFakeTimers();
    try {
      serveLatest(rendererOnly('1.0.1', 1));
      const { manager } = await loadManager();
      await manager.checkForUpdates();
      manager.applyStagedNow();

      vi.advanceTimersByTime(3500);

      expect(readPointer(otaRoot(), ABI)).toMatchObject({ blacklist: ['1.0.1'], current: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to apply when the staged renderer dir is unusable', async () => {
    serveLatest(rendererOnly('1.0.1', 1));
    const { app, manager } = await loadManager();
    await manager.checkForUpdates();
    rmSync(path.join(coreDir('1.0.1'), 'dist/renderer/apps/desktop/index.html'));
    app.rendererUrlManager.setActiveRendererDir = vi.fn(function (
      this: { activeDir: string | null },
      dir,
    ) {
      this.activeDir = dir && existsSync(path.join(dir, 'apps/desktop/index.html')) ? dir : null;
    });

    expect(manager.applyStagedNow()).toBe(false);

    expect(readPointer(otaRoot(), ABI)).toMatchObject({
      blacklist: ['1.0.1'],
      current: null,
      staged: null,
    });
    expect(manager.getStatus().staged).toBeNull();
  });

  it('reverts pointer.current when the channel switches after a relaunch stage', async () => {
    serveLatest(mainChanged('1.0.1', 1));
    const { manager } = await loadManager();
    await manager.checkForUpdates();
    expect(readPointer(otaRoot(), ABI).current).toBe('1.0.1');

    manager.switchChannel('canary');
    await flushGc();

    expect(readPointer(otaRoot(), ABI)).toMatchObject({ current: null, previous: null });
    expect(existsSync(coreDir('1.0.1'))).toBe(false);
  });

  it('auto-applies a reload-mode stage after five idle minutes, even when staged while idle', async () => {
    vi.useFakeTimers();
    try {
      serveLatest(rendererOnly('1.0.1', 1));
      const { app, manager } = await loadManager();
      manager.startScheduledChecks();
      await manager.checkForUpdates();

      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(app.rendererUrlManager.setActiveRendererDir).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(app.rendererUrlManager.setActiveRendererDir).toHaveBeenCalledWith(
        path.join(coreDir('1.0.1'), 'dist/renderer'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-apply while focused or after an unload veto', async () => {
    vi.useFakeTimers();
    try {
      serveLatest(rendererOnly('1.0.1', 1));
      const { app, manager } = await loadManager();
      manager.startScheduledChecks();
      await manager.checkForUpdates();
      const focus = electronMock.app.on.mock.calls.find(
        ([name]) => name === 'browser-window-focus',
      )![1];
      const blur = electronMock.app.on.mock.calls.find(
        ([name]) => name === 'browser-window-blur',
      )![1];

      focus();
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(app.rendererUrlManager.setActiveRendererDir).not.toHaveBeenCalled();

      manager.handleUnloadPrevented();
      blur();
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(app.rendererUrlManager.setActiveRendererDir).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a stage failure and clears staging', async () => {
    const remote = rendererOnly('1.0.1', 1);
    serveLatest({ ...remote, signature: remote.signature });
    served.delete(`${SERVER}/stable/core/${PLATFORM}/${remote.full.path}`);
    for (const key of served.keys()) if (key.startsWith(OBJECTS)) served.delete(key);
    const { manager } = await loadManager();

    await manager.checkForUpdates();

    expect(manager.getStatus().lastError).toMatch(/fetch failed/);
    expect(existsSync(path.join(otaRoot(), 'staging'))).toBe(false);
    serveLatest(null);
    await manager.checkForUpdates();
    expect(fetchImpl).toHaveBeenLastCalledWith(
      expect.stringContaining('latest.json'),
      expect.anything(),
    );
  });

  it('drops the staged version when the channel switches', async () => {
    serveLatest(rendererOnly('1.0.1', 1));
    const { manager } = await loadManager();
    await manager.checkForUpdates();
    expect(manager.getStatus().staged).toBe('1.0.1');

    manager.switchChannel('canary');
    await flushGc();

    expect(manager.getStatus().staged).toBeNull();
    expect(readPointer(otaRoot(), ABI).staged).toBeNull();
    expect(existsSync(coreDir('1.0.1'))).toBe(false);
  });
});
