import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson, type RendererManifest, sha256File } from '../manifest';
import { readPointer } from '../pointer';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const MAIN_HASH = 'a'.repeat(64);
const SERVER = 'https://updates.test';

let userDataDir: string;
let builtinDir: string;
const { updaterConfigMock } = vi.hoisted(() => ({
  updaterConfigMock: { buildChannel: 'stable' },
}));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
}));
vi.mock('@/const/dir', () => ({
  get rendererDir() {
    return builtinDir;
  },
}));
vi.mock('@/const/env', () => ({ isDev: false }));
vi.mock('@/modules/updater/configs', () => ({
  get BUILD_CHANNEL() {
    return updaterConfigMock.buildChannel;
  },
  UPDATE_CHANNEL: 'stable',
  UPDATE_SERVER_URL: 'https://updates.test',
  coerceStoredUpdateChannel: (channel?: string) => (channel === 'canary' ? 'canary' : 'stable'),
}));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const makeApp = () => ({
  browserManager: { broadcastToAllWindows: vi.fn(), browsers: new Map() },
  rendererUrlManager: { setActiveRendererDir: vi.fn() },
  storeManager: { get: vi.fn(() => 'stable') },
});

const channelDir = (channel = 'stable') => path.join(userDataDir, 'renderer-ota', channel);

const signManifest = (unsigned: Omit<RendererManifest, 'signature'>): RendererManifest => ({
  ...unsigned,
  signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64'),
});

const entryHtml = (marker: string) =>
  `<html><head><script type="module" src="/assets/entry-e2e.js"></script></head><body>${marker}</body></html>`;

const buildFeed = (version: string, files: Record<string, string>) => {
  const withEntries = {
    'apps/desktop/overlay.html': entryHtml(`${version}-overlay`),
    'apps/desktop/popup.html': entryHtml(`${version}-popup`),
    ...files,
  };
  const cas = new Map<string, Buffer>();
  const manifestFiles = Object.entries(withEntries).map(([filePath, text]) => {
    const content = Buffer.from(text);
    const sha256 = sha256File(content);
    cas.set(sha256, content);
    return { path: filePath, sha256, size: content.byteLength };
  });
  const manifest = signManifest({
    appVersion: '1.0.0',
    files: manifestFiles,
    mainHash: MAIN_HASH,
    version,
  });
  return { cas, manifest };
};

const stubFetch = (
  feed: { cas: Map<string, Buffer>; manifest: RendererManifest } | null,
  channel = 'stable',
) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `${SERVER}/renderer/${channel}/${MAIN_HASH}/latest.json`) {
        if (!feed) return new Response('nope', { status: 404 });
        return Response.json(feed.manifest);
      }
      const match = /\/renderer\/files\/([0-9a-f]{64})\.bin$/.exec(url);
      const content = match && feed?.cas.get(match[1]);
      if (content) return new Response(new Uint8Array(content));
      return new Response('nope', { status: 404 });
    }),
  );
};

const hasZstd = (() => {
  try {
    execFileSync('zstd', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const loadManager = async (app: ReturnType<typeof makeApp>) => {
  vi.resetModules();
  process.env.MAIN_HASH = MAIN_HASH;
  process.env.RENDERER_OTA_PUBLIC_KEY = PUBLIC_KEY_PEM;
  const { RendererUpdateManager } = await import('../RendererUpdateManager');
  return new RendererUpdateManager(app as never);
};

beforeEach(() => {
  updaterConfigMock.buildChannel = 'stable';
  userDataDir = mkdtempSync(path.join(tmpdir(), 'ota-user-'));
  builtinDir = mkdtempSync(path.join(tmpdir(), 'ota-builtin-'));
  mkdirSync(path.join(builtinDir, 'apps', 'desktop'), { recursive: true });
  writeFileSync(path.join(builtinDir, 'apps', 'desktop', 'index.html'), '<html>builtin</html>');
  writeFileSync(path.join(builtinDir, 'shared.js'), 'shared-content');
});

afterEach(() => {
  rmSync(userDataDir, { force: true, recursive: true });
  rmSync(builtinDir, { force: true, recursive: true });
  vi.unstubAllGlobals();
  delete process.env.MAIN_HASH;
  delete process.env.RENDERER_OTA_PUBLIC_KEY;
});

describe('RendererUpdateManager full path', () => {
  it('check → incremental download → stage → apply → boot ping → gc', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
      'shared.js': 'shared-content',
    });
    stubFetch(feed);

    await manager.checkForUpdates();

    const otaDir = channelDir();
    expect(readPointer(otaDir, MAIN_HASH).staged).toBe('r1');
    expect(app.browserManager.broadcastToAllWindows).toHaveBeenCalledWith('rendererUpdateReady', {
      appVersion: '1.0.0',
      version: 'r1',
    });

    const fetchedUrls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const casFetches = fetchedUrls.filter((u: string) => u.includes('/renderer/files/'));
    expect(casFetches).toHaveLength(4);

    expect(manager.applyStagedNow()).toBe(true);
    expect(app.rendererUrlManager.setActiveRendererDir).toHaveBeenLastCalledWith(
      path.join(otaDir, 'versions', 'r1'),
    );
    expect(
      readFileSync(path.join(otaDir, 'versions', 'r1', 'apps', 'desktop', 'index.html'), 'utf8'),
    ).toBe(entryHtml('v1'));
    expect(readPointer(otaDir, MAIN_HASH).pendingBootCheck).toBe(true);

    manager.handleBootPing();
    const committed = readPointer(otaDir, MAIN_HASH);
    expect(committed.pendingBootCheck).toBe(false);
    expect(committed.current).toBe('r1');

    expect(manager.getStatus().state).toBe('idle');
    stubFetch(
      buildFeed('r2', {
        'apps/desktop/index.html': entryHtml('v2'),
        'assets/entry-e2e.js': 'console.log("v2")',
      }),
    );
    await manager.checkForUpdates();
    expect(readPointer(otaDir, MAIN_HASH).staged).toBe('r2');
  });

  it.skipIf(!hasZstd)('downloads only zstd patches when a delta from r0 applies', async () => {
    const app = makeApp();
    const oldChunk = Buffer.alloc(32 * 1024, 7);
    writeFileSync(path.join(builtinDir, 'chunk.bin'), oldChunk);

    const newChunk = Buffer.from(oldChunk);
    newChunk[10] = 9;
    const dir = mkdtempSync(path.join(tmpdir(), 'ota-delta-'));
    const oldPath = path.join(dir, 'old.bin');
    const newPath = path.join(dir, 'new.bin');
    const patchPath = path.join(dir, 'patch.zst');
    writeFileSync(oldPath, oldChunk);
    writeFileSync(newPath, newChunk);
    execFileSync('zstd', ['--patch-from', oldPath, '-19', '-q', '-f', newPath, '-o', patchPath]);
    const patch = readFileSync(patchPath);

    const manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
      'chunk.bin': newChunk.toString('latin1'),
      'shared.js': 'shared-content',
    });
    const chunkFile = feed.manifest.files.find((f) => f.path === 'chunk.bin');
    const sharedFile = feed.manifest.files.find((f) => f.path === 'shared.js');
    if (!chunkFile || !sharedFile) throw new Error('expected files');
    const patchSha = sha256File(patch);
    feed.cas.set(patchSha, patch);
    feed.cas.set(chunkFile.sha256, newChunk);
    const { signature: _ignored, ...unsigned } = feed.manifest;
    feed.manifest = signManifest({
      ...unsigned,
      deltas: [
        {
          fromVersion: 'r0',
          ops: [
            { op: 'copy', path: 'shared.js', sha256: sharedFile.sha256 },
            {
              fromSha256: sha256File(oldChunk),
              op: 'patch',
              patchSha256: patchSha,
              patchSize: patch.byteLength,
              path: 'chunk.bin',
              sha256: chunkFile.sha256,
              size: newChunk.byteLength,
            },
            ...feed.manifest.files
              .filter((f) => f.path !== 'shared.js' && f.path !== 'chunk.bin')
              .map((f) => ({ op: 'full' as const, path: f.path, sha256: f.sha256, size: f.size })),
          ],
        },
      ],
    });

    stubFetch(feed);
    await manager.checkForUpdates();

    const fetchedUrls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const casFetches = fetchedUrls.filter((u: string) => u.includes('/renderer/files/'));
    expect(casFetches).toContain(`${SERVER}/renderer/files/${patchSha}.bin`);
    expect(casFetches).not.toContain(`${SERVER}/renderer/files/${sharedFile.sha256}.bin`);
    expect(readPointer(channelDir(), MAIN_HASH).staged).toBe('r1');
    expect(readFileSync(path.join(channelDir(), 'versions', 'r1', 'chunk.bin'))).toEqual(newChunk);
  });

  it('accepts gzip-compressed CAS objects when Content-Encoding is missing', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === `${SERVER}/renderer/stable/${MAIN_HASH}/latest.json`) {
          return Response.json(feed.manifest);
        }
        const match = /\/renderer\/files\/([0-9a-f]{64})\.bin$/.exec(url);
        const content = match && feed.cas.get(match[1]);
        if (content) return new Response(new Uint8Array(gzipSync(content)));
        return new Response('nope', { status: 404 });
      }),
    );

    await manager.checkForUpdates();

    expect(readPointer(channelDir(), MAIN_HASH).staged).toBe('r1');
    expect(
      readFileSync(
        path.join(channelDir(), 'versions', 'r1', 'apps', 'desktop', 'index.html'),
        'utf8',
      ),
    ).toBe(entryHtml('v1'));
  });

  it('rejects a manifest signed by a foreign key', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('evil'),
      'assets/entry-e2e.js': 'evil',
    });
    const foreign = generateKeyPairSync('ed25519').privateKey;
    const { signature: _sig, ...unsigned } = feed.manifest;
    feed.manifest = {
      ...unsigned,
      signature: sign(null, Buffer.from(canonicalJson(unsigned)), foreign).toString('base64'),
    };
    stubFetch(feed);

    await manager.checkForUpdates();

    expect(readPointer(channelDir(), MAIN_HASH).staged).toBeNull();
    expect(app.browserManager.broadcastToAllWindows).not.toHaveBeenCalled();
  });

  it('discards staging when a downloaded file is tampered', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
    });
    const [sha] = feed.cas.keys();
    feed.cas.set(sha, Buffer.from('tampered-on-cdn'));
    stubFetch(feed);

    await manager.checkForUpdates();

    const otaDir = channelDir();
    expect(readPointer(otaDir, MAIN_HASH).staged).toBeNull();
    expect(existsSync(path.join(otaDir, 'staging'))).toBe(false);
  });

  it('rewrites the pointer on disk when mainHash changed (new full release)', async () => {
    const otaDir = channelDir();
    mkdirSync(otaDir, { recursive: true });
    writeFileSync(
      path.join(otaDir, 'pointer.json'),
      JSON.stringify({
        blacklist: ['r9'],
        current: 'r9',
        mainHash: 'b'.repeat(64),
        pendingBootCheck: false,
        previous: null,
        staged: null,
      }),
    );

    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    const onDisk = JSON.parse(readFileSync(path.join(otaDir, 'pointer.json'), 'utf8'));
    expect(onDisk.mainHash).toBe(MAIN_HASH);
    expect(onDisk.current).toBeNull();
    expect(onDisk.blacklist).toEqual([]);
    expect(app.rendererUrlManager.setActiveRendererDir).toHaveBeenLastCalledWith(null);
  });

  it('rolls back and blacklists when the previous session never passed boot check', async () => {
    const app = makeApp();
    let manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
    });
    stubFetch(feed);
    await manager.checkForUpdates();
    manager.applyStagedNow();

    const app2 = makeApp();
    manager = await loadManager(app2);
    manager.initialize();

    const pointer = readPointer(channelDir(), MAIN_HASH);
    expect(pointer.current).toBeNull();
    expect(pointer.blacklist).toContain('r1');
    expect(app2.rendererUrlManager.setActiveRendererDir).toHaveBeenLastCalledWith(null);

    await manager.checkForUpdates();
    expect(readPointer(channelDir(), MAIN_HASH).staged).toBeNull();
  });

  it('rejects a staged tree whose entry html references a missing chunk', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    stubFetch(
      buildFeed('r1', {
        'apps/desktop/index.html':
          '<html><script type="module" src="/assets/gone.js"></script></html>',
      }),
    );

    await manager.checkForUpdates();

    const otaDir = channelDir();
    expect(readPointer(otaDir, MAIN_HASH).staged).toBeNull();
    expect(existsSync(path.join(otaDir, 'staging'))).toBe(false);
  });

  it('rejects a staged tree whose popup entry references a missing chunk', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    stubFetch(
      buildFeed('r1', {
        'apps/desktop/index.html': entryHtml('v1'),
        'apps/desktop/popup.html':
          '<html><script type="module" src="/assets/gone.js"></script></html>',
        'assets/entry-e2e.js': 'console.log("v1")',
      }),
    );

    await manager.checkForUpdates();

    const otaDir = channelDir();
    expect(readPointer(otaDir, MAIN_HASH).staged).toBeNull();
    expect(existsSync(path.join(otaDir, 'staging'))).toBe(false);
  });

  it('rolls back within seconds when the load ping never arrives after hot apply', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    stubFetch(
      buildFeed('r1', {
        'apps/desktop/index.html': entryHtml('v1'),
        'assets/entry-e2e.js': 'throw new Error("boom")',
      }),
    );
    await manager.checkForUpdates();

    vi.useFakeTimers();
    try {
      manager.applyStagedNow();
      vi.advanceTimersByTime(3100);
    } finally {
      vi.useRealTimers();
    }

    const pointer = readPointer(channelDir(), MAIN_HASH);
    expect(pointer.current).toBeNull();
    expect(pointer.blacklist).toContain('r1');
  });

  it('load ping defers the verdict to the mount-stage timeout', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    stubFetch(
      buildFeed('r1', {
        'apps/desktop/index.html': entryHtml('v1'),
        'assets/entry-e2e.js': 'console.log("v1")',
      }),
    );
    await manager.checkForUpdates();

    const otaDir = channelDir();
    vi.useFakeTimers();
    try {
      manager.applyStagedNow();
      manager.handleBootPing('loaded');
      vi.advanceTimersByTime(5000);
      expect(readPointer(otaDir, MAIN_HASH).current).toBe('r1');

      vi.advanceTimersByTime(11_000);
    } finally {
      vi.useRealTimers();
    }

    const pointer = readPointer(otaDir, MAIN_HASH);
    expect(pointer.current).toBeNull();
    expect(pointer.blacklist).toContain('r1');
  });

  it('keeps patch versions independent when the update channel changes', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
    });
    stubFetch(feed);
    await manager.checkForUpdates();
    expect(readPointer(channelDir(), MAIN_HASH).staged).toBe('r1');

    manager.switchChannel('canary');
    expect(readPointer(channelDir('canary'), MAIN_HASH).staged).toBeNull();
    expect(app.rendererUrlManager.setActiveRendererDir).toHaveBeenLastCalledWith(null);

    stubFetch(feed, 'canary');
    await manager.checkForUpdates();
    expect(readPointer(channelDir('canary'), MAIN_HASH).staged).toBe('r1');
    expect(readPointer(channelDir(), MAIN_HASH).staged).toBe('r1');
  });

  it('uses a dedicated beta feed for beta binaries', async () => {
    updaterConfigMock.buildChannel = 'beta';
    const app = makeApp();
    app.storeManager.get.mockReturnValue('canary');
    const manager = await loadManager(app);
    manager.initialize();

    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('beta'),
      'assets/entry-e2e.js': 'console.log("beta")',
    });
    stubFetch(feed, 'beta');
    await manager.checkForUpdates();

    expect(readPointer(channelDir('beta'), MAIN_HASH).staged).toBe('r1');
  });
});
