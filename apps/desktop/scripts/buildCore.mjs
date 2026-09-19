import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import {
  createCoreManifest,
  parseArgs,
  readCoreTree,
  readPrivateKey,
  writeCoreManifest,
} from './buildCoreManifest.mjs';
import { encodePack } from './buildRendererManifest.mjs';
import { generateZstdPatch, pairRendererFiles } from './rendererDelta.mjs';

const PATCH_SCOPE = /^(?:dist\/renderer|cli)\//;
const RELOAD_SCOPE = 'dist/renderer/';
const ZSTD_LEVEL = { params: { [constants.ZSTD_c_compressionLevel]: 19 } };

export class EmptyReleaseError extends Error {
  constructor() {
    super('empty release');
  }
}

const sha256Of = (content) => createHash('sha256').update(content).digest('hex');

const writeIfMissing = (file, content) => {
  if (existsSync(file)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
};

const changedPaths = (fromTree, toTree) => {
  const from = new Map(fromTree.map((file) => [file.path, file.sha256]));
  const to = new Map(toTree.map((file) => [file.path, file.sha256]));
  return [...new Set([...from.keys(), ...to.keys()])].filter(
    (filePath) => from.get(filePath) !== to.get(filePath),
  );
};

const previousObject = async (sha256, outDir, objectsBaseUrl, fetchImpl) => {
  try {
    const local = path.join(outDir, 'cas/objects', `${sha256}.zst`);
    let content;
    if (existsSync(local)) {
      content = zstdDecompressSync(readFileSync(local));
    } else {
      const response = await fetchImpl(`${objectsBaseUrl}/objects/${sha256}.zst`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      content = zstdDecompressSync(Buffer.from(await response.arrayBuffer()));
    }
    if (sha256Of(content) !== sha256) throw new Error('sha256 mismatch');
    return content;
  } catch (error) {
    console.error(`patch skipped ${sha256}: ${error.message}`);
    return null;
  }
};

const buildPatches = async ({ fetchImpl, objects, objectsBaseUrl, outDir, previousTree, tree }) => {
  const patches = new Map();
  const pairings = pairRendererFiles(
    previousTree.filter((file) => PATCH_SCOPE.test(file.path)),
    tree.filter((file) => PATCH_SCOPE.test(file.path)),
  );
  for (const pairing of pairings) {
    if (pairing.kind !== 'patch') continue;
    const key = `${pairing.from.sha256}-${pairing.to.sha256}`;
    if (patches.has(key)) continue;
    const oldContent = await previousObject(pairing.from.sha256, outDir, objectsBaseUrl, fetchImpl);
    if (!oldContent) continue;
    const patch = await generateZstdPatch(oldContent, objects.get(pairing.to.sha256));
    if (!patch) continue;
    writeIfMissing(path.join(outDir, 'cas/patches', `${key}.zst`), patch);
    patches.set(key, {
      fromSha256: pairing.from.sha256,
      size: patch.byteLength,
      toSha256: pairing.to.sha256,
    });
  }
  return [...patches.values()].sort((a, b) => a.toSha256.localeCompare(b.toSha256));
};

export async function buildCore({
  channel,
  coreDir,
  fetchImpl = fetch,
  objectsBaseUrl,
  outDir,
  platform,
  previousManifest = null,
  privateKeyPem,
  rollout = 1,
  seq,
  shellAbi,
  version,
}) {
  if (!privateKeyPem) throw new Error('private key required (--private-key-file or env)');
  const { objects, tree } = readCoreTree(coreDir);

  let applyMode = null;
  let patches = [];
  if (previousManifest) {
    const changed = changedPaths(previousManifest.tree, tree);
    if (changed.every((filePath) => filePath === 'package.json')) throw new EmptyReleaseError();
    applyMode = changed.every((filePath) => filePath.startsWith(RELOAD_SCOPE))
      ? 'reload'
      : 'relaunch';
  }

  let objectsWritten = 0;
  let objectBytes = 0;
  for (const [sha256, content] of objects) {
    const file = path.join(outDir, 'cas/objects', `${sha256}.zst`);
    if (existsSync(file)) {
      objectBytes += statSync(file).size;
      continue;
    }
    const zst = zstdCompressSync(content, ZSTD_LEVEL);
    objectBytes += zst.byteLength;
    writeIfMissing(file, zst);
    objectsWritten += 1;
  }

  if (previousManifest) {
    patches = await buildPatches({
      fetchImpl,
      objects,
      objectsBaseUrl,
      outDir,
      previousTree: previousManifest.tree,
      tree,
    });
  }

  const pack = encodePack(
    new Map([...objects].map(([sha256, content]) => [`objects/${sha256}`, { content }])),
  );
  const packSha256 = sha256Of(pack);
  const full = { path: `packs/${packSha256}.zip`, sha256: packSha256, size: pack.byteLength };
  const platformDir = path.join(outDir, 'core', platform);
  writeIfMissing(path.join(platformDir, full.path), pack);

  const manifest = createCoreManifest({
    applyMode,
    channel,
    full,
    objectsBaseUrl,
    patches,
    platform,
    previous: previousManifest?.version ?? null,
    privateKeyPem,
    rollout,
    seq,
    shellAbi,
    tree,
    version,
  });
  const json = JSON.stringify(manifest, null, 2);
  mkdirSync(path.join(platformDir, 'versions'), { recursive: true });
  writeFileSync(path.join(platformDir, 'versions', `${version}.json`), json);
  writeFileSync(path.join(platformDir, 'latest.json'), json);
  writeCoreManifest(coreDir, manifest);

  return {
    manifest,
    stats: { objectBytes, objects: objects.size, objectsWritten, patches: patches.length },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  try {
    const { manifest, stats } = await buildCore({
      channel: args.channel,
      coreDir: path.resolve(args.core ?? 'core-dist'),
      objectsBaseUrl: args['objects-base-url'],
      outDir: path.resolve(args.out ?? 'release/core-ota'),
      platform: args.platform,
      previousManifest: args['previous-manifest']
        ? JSON.parse(readFileSync(args['previous-manifest'], 'utf8'))
        : null,
      privateKeyPem: readPrivateKey(args),
      rollout: args.rollout === undefined ? 1 : Number(args.rollout),
      seq: Number(args.seq),
      shellAbi: args['shell-abi'],
      version: args.version,
    });
    console.log(
      `core ${manifest.channel}/${manifest.platform} ${manifest.version} seq ${manifest.seq}: ` +
        `${manifest.tree.length} files, ${stats.objects} objects (${stats.objectsWritten} new, ${(stats.objectBytes / 1048576).toFixed(2)} MB zst), ` +
        `${stats.patches} patches, full ${(manifest.full.size / 1048576).toFixed(2)} MB, ` +
        `applyMode ${manifest.applyMode}, previous ${manifest.previous}, ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  } catch (error) {
    if (error instanceof EmptyReleaseError) {
      console.error('empty release');
      process.exit(3);
    }
    throw error;
  }
}
