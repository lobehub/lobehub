import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';

import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalJson,
  type RendererDeltaPackMetadata,
  type RendererManifest,
  type RendererPackMetadata,
  type RendererTreeFile,
  sha256File,
} from '../manifest';
import { readPointer } from '../pointer';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const APP_VERSION = '1.0.0';
const MAIN_HASH = 'a'.repeat(64);
const SERVER = 'https://updates.test';

let userDataDir: string;
let builtinDir: string;
const { updaterConfigMock } = vi.hoisted(() => ({
  updaterConfigMock: { buildChannel: 'stable' },
}));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getVersion: () => APP_VERSION },
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
  UPDATE_SERVER_URL: 'https://updates.test/stable',
  coerceStoredUpdateChannel: (channel?: string) => (channel === 'canary' ? 'canary' : 'stable'),
}));
const makeApp = () => ({
  browserManager: { broadcastToAllWindows: vi.fn(), browsers: new Map() },
  rendererUrlManager: { setActiveRendererDir: vi.fn() },
  storeManager: { get: vi.fn(() => 'stable') },
});

const channelDir = (channel = 'stable') => path.join(userDataDir, 'renderer-ota-v2', channel);

const signManifest = (unsigned: Omit<RendererManifest, 'signature'>): RendererManifest => ({
  ...unsigned,
  signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64'),
});

const entryHtml = (marker: string) =>
  `<html><head><script type="module" src="/assets/entry-e2e.js"></script></head><body>${marker}</body></html>`;

type Feed = {
  manifest: RendererManifest;
  objects: Map<string, Buffer>;
  packs: Map<string, Buffer>;
  tree: RendererTreeFile[];
};

const createPack = (metadata: RendererPackMetadata, entries: Map<string, Buffer>) => {
  const input = Object.fromEntries([
    ['meta.json', Buffer.from(JSON.stringify(metadata))],
    ...entries,
  ]);
  const content = Buffer.from(zipSync(input));
  const sha256 = sha256File(content);
  return {
    artifact: { path: `packs/${sha256}.zip`, sha256, size: content.byteLength },
    content,
  };
};

const buildFeed = (version: string, files: Record<string, Buffer | string>): Feed => {
  const withEntries = {
    'apps/desktop/overlay.html': entryHtml(`${version}-overlay`),
    'apps/desktop/popup.html': entryHtml(`${version}-popup`),
    ...files,
  };
  const objects = new Map<string, Buffer>();
  const tree = Object.entries(withEntries).map(([filePath, value]) => {
    const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const sha256 = sha256File(content);
    objects.set(sha256, content);
    return { path: filePath, sha256, size: content.byteLength };
  });
  const fullPack = createPack(
    { kind: 'full', packVersion: 1, tree, version },
    new Map([...objects].map(([sha256, content]) => [`objects/${sha256}`, content])),
  );
  return {
    manifest: signManifest({
      appVersion: APP_VERSION,
      full: fullPack.artifact,
      mainHash: MAIN_HASH,
      schemaVersion: 2,
      version,
    }),
    objects,
    packs: new Map([[fullPack.artifact.path, fullPack.content]]),
    tree,
  };
};

const addDelta = (
  feed: Feed,
  delta: Pick<RendererDeltaPackMetadata, 'fromVersion' | 'objects' | 'patches'>,
  payloads: Map<string, Buffer>,
) => {
  const pack = createPack(
    {
      ...delta,
      kind: 'delta',
      packVersion: 1,
      tree: feed.tree,
      version: feed.manifest.version,
    },
    payloads,
  );
  feed.packs.set(pack.artifact.path, pack.content);
  const { signature: _signature, ...unsigned } = feed.manifest;
  feed.manifest = signManifest({
    ...unsigned,
    deltas: [{ fromVersion: delta.fromVersion, pack: pack.artifact }],
  });
};

const stubFetch = (feed: Feed | null, channel = 'stable') => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const root = `${SERVER}/${channel}/${APP_VERSION}/renderer/v2`;
      if (url === `${root}/latest.json`) {
        if (!feed) return new Response('nope', { status: 404 });
        return Response.json(feed.manifest);
      }
      const relative = url.startsWith(`${root}/`) ? url.slice(root.length + 1) : '';
      const content = feed?.packs.get(relative);
      if (content) return new Response(new Uint8Array(content));
      return new Response('nope', { status: 404 });
    }),
  );
};

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

describe('RendererUpdateManager V2 lifecycle', () => {
  it('downloads one full pack, stages it, applies it, and commits after boot ping', async () => {
    const app = makeApp();
    const reloadIgnoringCache = vi.fn();
    app.browserManager.browsers.set('app', {
      browserWindow: { webContents: { reloadIgnoringCache } },
    });
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
    expect(app.browserManager.broadcastToAllWindows).toHaveBeenCalledWith('updateReady', {
      kind: 'renderer',
      version: APP_VERSION,
    });
    const fetchedUrls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(fetchedUrls).toEqual([
      `${SERVER}/stable/${APP_VERSION}/renderer/v2/latest.json`,
      `${SERVER}/stable/${APP_VERSION}/renderer/v2/${feed.manifest.full.path}`,
    ]);
    expect(fetchedUrls.some((url: string) => url.includes('/renderer/files/'))).toBe(false);

    expect(manager.applyStagedNow()).toBe(true);
    expect(reloadIgnoringCache).toHaveBeenCalledOnce();
    expect(
      readFileSync(path.join(otaDir, 'versions', 'r1', 'apps', 'desktop', 'index.html'), 'utf8'),
    ).toBe(entryHtml('v1'));
    manager.handleBootPing();
    expect(readPointer(otaDir, MAIN_HASH)).toMatchObject({
      current: 'r1',
      pendingBootCheck: false,
    });
  });

  it('uses one delta pack to reuse, patch, and add renderer files', async () => {
    const oldChunk = Buffer.alloc(32 * 1024, 7);
    const newChunk = Buffer.from(oldChunk);
    newChunk[10] = 9;
    writeFileSync(path.join(builtinDir, 'chunk.bin'), oldChunk);

    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();
    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
      'chunk.bin': newChunk,
      'shared.js': 'shared-content',
    });
    const chunk = feed.tree.find((file) => file.path === 'chunk.bin');
    const shared = feed.tree.find((file) => file.path === 'shared.js');
    if (!chunk || !shared) throw new Error('expected files');
    const patch = Buffer.from(zstdCompressSync(newChunk, { dictionary: oldChunk }));
    const patchSha256 = sha256File(patch);
    const fullObjects = feed.tree.filter(
      (file) => file.sha256 !== chunk.sha256 && file.sha256 !== shared.sha256,
    );
    addDelta(
      feed,
      {
        fromVersion: 'r0',
        objects: fullObjects.map((file) => file.sha256),
        patches: [{ fromSha256: sha256File(oldChunk), patchSha256, toSha256: chunk.sha256 }],
      },
      new Map([
        ...fullObjects.map(
          (file) => [`objects/${file.sha256}`, feed.objects.get(file.sha256) as Buffer] as const,
        ),
        [`patches/${patchSha256}`, patch],
      ]),
    );
    stubFetch(feed);

    await manager.checkForUpdates();

    const fetchedUrls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    const delta = feed.manifest.deltas?.[0];
    expect(fetchedUrls).toEqual([
      `${SERVER}/stable/${APP_VERSION}/renderer/v2/latest.json`,
      `${SERVER}/stable/${APP_VERSION}/renderer/v2/${delta?.pack.path}`,
    ]);
    expect(readFileSync(path.join(channelDir(), 'versions', 'r1', 'chunk.bin'))).toEqual(newChunk);
  });

  it('falls back to the full pack when the selected delta pack is corrupt', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();
    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
      'shared.js': 'shared-content',
    });
    const localHash = sha256File(Buffer.from('shared-content'));
    const targetHashes = [
      ...new Set(feed.tree.filter((file) => file.sha256 !== localHash).map((file) => file.sha256)),
    ];
    addDelta(
      feed,
      { fromVersion: 'r0', objects: targetHashes, patches: [] },
      new Map(
        targetHashes.map((sha256) => [`objects/${sha256}`, feed.objects.get(sha256) as Buffer]),
      ),
    );
    const delta = feed.manifest.deltas?.[0];
    if (!delta) throw new Error('expected delta');
    feed.packs.set(delta.pack.path, Buffer.from('corrupt'));
    stubFetch(feed);

    await manager.checkForUpdates();

    const fetchedUrls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(fetchedUrls).toEqual([
      `${SERVER}/stable/${APP_VERSION}/renderer/v2/latest.json`,
      `${SERVER}/stable/${APP_VERSION}/renderer/v2/${delta.pack.path}`,
      `${SERVER}/stable/${APP_VERSION}/renderer/v2/${feed.manifest.full.path}`,
    ]);
    expect(readPointer(channelDir(), MAIN_HASH).staged).toBe('r1');
  });

  it('keeps the current renderer when a full pack fails integrity verification', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();
    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
    });
    feed.packs.set(feed.manifest.full.path, Buffer.from('tampered-on-cdn'));
    stubFetch(feed);

    await manager.checkForUpdates();

    expect(readPointer(channelDir(), MAIN_HASH).staged).toBeNull();
    expect(existsSync(path.join(channelDir(), 'staging'))).toBe(false);
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
    const { signature: _signature, ...unsigned } = feed.manifest;
    feed.manifest = {
      ...unsigned,
      signature: sign(null, Buffer.from(canonicalJson(unsigned)), foreign).toString('base64'),
    };
    stubFetch(feed);

    await manager.checkForUpdates();

    expect(readPointer(channelDir(), MAIN_HASH).staged).toBeNull();
    expect(app.browserManager.broadcastToAllWindows).not.toHaveBeenCalled();
  });

  it('clears the complete V1 root without migrating its state', async () => {
    const legacyRoot = path.join(userDataDir, 'renderer-ota');
    const legacyDir = path.join(legacyRoot, 'stable');
    mkdirSync(path.join(legacyDir, 'versions', 'r9', 'assets'), { recursive: true });
    mkdirSync(path.join(legacyDir, 'staging', 'r10'), { recursive: true });
    mkdirSync(path.join(legacyRoot, 'cache'), { recursive: true });
    writeFileSync(
      path.join(legacyDir, 'pointer.json'),
      JSON.stringify({ current: 'r9', mainHash: MAIN_HASH }),
    );
    writeFileSync(path.join(legacyDir, 'versions', 'r9', 'assets', 'app.js'), 'v1');
    writeFileSync(path.join(legacyRoot, 'cache', 'patch.bin'), 'cached-patch');

    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();

    expect(readPointer(channelDir(), MAIN_HASH).current).toBeNull();
    expect(existsSync(legacyRoot)).toBe(false);
    expect(app.rendererUrlManager.setActiveRendererDir).toHaveBeenLastCalledWith(null);
  });

  it('resets V2 state when a full release changes mainHash', async () => {
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

    expect(readPointer(otaDir, MAIN_HASH)).toMatchObject({
      blacklist: [],
      current: null,
      mainHash: MAIN_HASH,
    });
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

    expect(readPointer(channelDir(), MAIN_HASH).staged).toBeNull();
    expect(existsSync(path.join(channelDir(), 'staging'))).toBe(false);
  });

  it('rolls back and blacklists a renderer that never sends the load ping', async () => {
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

    expect(readPointer(channelDir(), MAIN_HASH)).toMatchObject({
      blacklist: ['r1'],
      current: null,
    });
  });

  it('keeps V2 patch state independent across update channels', async () => {
    const app = makeApp();
    const manager = await loadManager(app);
    manager.initialize();
    const feed = buildFeed('r1', {
      'apps/desktop/index.html': entryHtml('v1'),
      'assets/entry-e2e.js': 'console.log("v1")',
    });
    stubFetch(feed);
    await manager.checkForUpdates();

    manager.switchChannel('canary');
    stubFetch(feed, 'canary');
    await manager.checkForUpdates();

    expect(readPointer(channelDir(), MAIN_HASH).staged).toBe('r1');
    expect(readPointer(channelDir('canary'), MAIN_HASH).staged).toBe('r1');
  });

  it('uses the dedicated V2 beta feed for beta binaries', async () => {
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
