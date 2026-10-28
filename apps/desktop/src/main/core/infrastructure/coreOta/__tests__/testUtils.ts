import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';

import { zipSync } from 'fflate';
import { expect, vi } from 'vitest';

import type { ShellGlobal } from '@/const/shell';

import { canonicalJson, type CoreManifestV3 as CoreManifest, sha256File } from '../manifest';
import type { readPointer } from '../pointer';
import { writePointer } from '../pointer';
import type { RendererSource } from '../rendererSource';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();
export const ABI = 'a'.repeat(64);
export const SERVER = 'https://updates.test';
export const OBJECTS = 'https://cdn.test/cas';
const ORIGINAL_PLATFORM = process.platform;
export const PLATFORM = 'linux' as CoreManifest['platform'];

export const BASE_FILES: Record<string, string> = {
  'dist/main/index.js': 'main-v1',
  'dist/renderer/apps/desktop/index.html': '<script src="/assets/index.js"></script>',
  'dist/renderer/apps/desktop/overlay.html': '<script src="/assets/overlay.js"></script>',
  'dist/renderer/apps/desktop/popup.html': '<script src="/assets/popup.js"></script>',
  'dist/renderer/assets/index.js': 'index-v1',
  'dist/renderer/assets/overlay.js': 'overlay',
  'dist/renderer/assets/popup.js': 'popup',
  'package.json': '{"main":"dist/main/index.js"}',
};

export const fixture = {} as {
  builtinDir: string;
  builtinManifest: CoreManifest;
  served: Map<string, Buffer>;
  userDataDir: string;
};

export const makeApp = () => ({
  browserManager: {
    broadcastToAllWindows: vi.fn(),
    browsers: new Map([
      [
        'main',
        {
          browserWindow: { webContents: { id: 1, reloadIgnoringCache: vi.fn() } },
          cancelUnloadConfirmation: vi.fn(),
          reloadIgnoringCache: vi.fn(function (this: {
            browserWindow: { webContents: { reloadIgnoringCache: () => void } };
          }) {
            this.browserWindow.webContents.reloadIgnoringCache();
          }),
        },
      ],
    ]),
  },
  isQuiting: false,
  rendererUrlManager: {
    activeRenderer: null as RendererSource | null,
    getActiveRenderer() {
      return this.activeRenderer;
    },
    setActiveRenderer: vi.fn(function (
      this: { activeRenderer: RendererSource | null },
      source: RendererSource | null,
    ) {
      this.activeRenderer = source;
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

export const buildManifest = (
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
  fixture.served.set(`${SERVER}/stable/core/${PLATFORM}/packs/${packSha}.zip`, pack);
  for (const [, content] of objects) {
    fixture.served.set(`${OBJECTS}/objects/${sha256File(content)}.zst`, zst(content));
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

export const materialize = (dir: string, files: Record<string, string>, manifest: CoreManifest) => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), c);
  }
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
};

export const serveLatest = (manifest: CoreManifest | null) => {
  const url = `${SERVER}/stable/core/${PLATFORM}/latest.json`;
  if (manifest) fixture.served.set(url, Buffer.from(JSON.stringify(manifest)));
  else fixture.served.delete(url);
};

export const fetchImpl = vi.fn(async (url: string) =>
  fixture.served.has(url)
    ? new Response(new Uint8Array(fixture.served.get(url)!))
    : new Response('nope', { status: 404 }),
);

export const otaRoot = () => path.join(fixture.userDataDir, 'core-ota');
export const storeDir = () => path.join(otaRoot(), 'store');
export const pointerAt = (patch: Partial<ReturnType<typeof readPointer>>) =>
  writePointer(otaRoot(), {
    abi: ABI,
    blacklist: [],
    channel: 'stable',
    current: null,
    previous: null,
    staged: null,
    ...patch,
  });
export const coreDir = (version: string) => path.join(otaRoot(), 'cores', version);

export const makeShell = (overrides: Partial<ShellGlobal> = {}): ShellGlobal => ({
  abi: ABI,
  builtinDir: fixture.builtinDir,
  coreDir: fixture.builtinDir,
  log: [],
  manifest: fixture.builtinManifest,
  markHealthy: () => {},
  publicKey: PUBLIC_KEY_PEM,
  shellVersion: '1.0.0',
  source: 'builtin',
  ...overrides,
});

export const loadManager = async (app = makeApp(), shell: ShellGlobal | null = makeShell()) => {
  vi.resetModules();
  const { CoreUpdateManager } = await import('../CoreUpdateManager');
  const manager = new CoreUpdateManager(app as never, { fetchImpl, shell: shell ?? undefined });
  manager.initialize();
  return { app, manager };
};

export const expectAppliedRenderer = (app: ReturnType<typeof makeApp>, indexContent: string) => {
  const renderer = app.rendererUrlManager.setActiveRenderer.mock.calls.at(-1)?.[0];
  expect(readFileSync(renderer!.resolve('assets/index.js')!, 'utf8')).toBe(indexContent);
  expect(readFileSync(renderer!.resolve('assets/popup.js')!, 'utf8')).toBe('popup');
};

export const flushGc = (manager: unknown) => (manager as { gcTask: Promise<void> }).gcTask;

export const setupOtaFixture = () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  fixture.served = new Map();
  fixture.userDataDir = mkdtempSync(path.join(tmpdir(), 'core-ota-user-'));
  fixture.builtinDir = mkdtempSync(path.join(tmpdir(), 'core-ota-builtin-'));
  fixture.builtinManifest = buildManifest('1.0.0', 0, BASE_FILES);
  materialize(fixture.builtinDir, BASE_FILES, fixture.builtinManifest);
};

export const teardownOtaFixture = () => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM });
  rmSync(fixture.userDataDir, { force: true, recursive: true });
  rmSync(fixture.builtinDir, { force: true, recursive: true });
};

export const rendererOnly = (version: string, seq: number) =>
  buildManifest(version, seq, {
    ...BASE_FILES,
    'dist/renderer/assets/index.js': `index-${version}`,
  });

export const mainChanged = (version: string, seq: number) =>
  buildManifest(version, seq, { ...BASE_FILES, 'dist/main/index.js': `main-${version}` });
