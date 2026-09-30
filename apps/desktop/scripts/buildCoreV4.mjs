import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { constants, zstdCompress, zstdDecompress } from 'node:zlib';

import { EmptyReleaseError, readCoreTree } from './buildCoreManifest.mjs';
import { signManifest } from './buildRendererManifest.mjs';
import { generateZstdPatch, pairRendererFiles } from './rendererDelta.mjs';

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);
const hash = (content) => createHash('sha256').update(content).digest('hex');
const PATCH_SCOPE = /^(?:dist\/renderer|cli)\//;

export async function writeCorePack(entries, output) {
  const chunks = [];
  const index = {};
  let offset = 0;
  for (const [key, bytes] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    index[key] = { compressedSha256: hash(bytes), length: bytes.length, offset };
    chunks.push(bytes);
    offset += bytes.length;
  }
  const bytes = Buffer.concat(chunks);
  const sha256 = hash(bytes);
  const pack = { path: `packs/${sha256}.pack`, sha256, size: bytes.length };
  await mkdir(path.join(output, 'packs'), { recursive: true });
  await writeFile(path.join(output, pack.path), bytes);
  for (const frame of Object.values(index)) frame.packSha256 = sha256;
  return { index, pack };
}

async function boundedBody(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Previous content exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function previousContent(manifest, sha256, baseUrl, fetchImpl) {
  if (manifest.schemaVersion !== 4) {
    const response = await fetchImpl(`${manifest.objectsBaseUrl}/objects/${sha256}.zst`);
    if (!response.ok) throw new Error(`Previous object HTTP ${response.status}`);
    const bytes = await decompress(await boundedBody(response, 256 * 1024 ** 2), {
      maxOutputLength: 256 * 1024 ** 2,
    });
    if (hash(bytes) !== sha256) throw new Error('Previous object hash mismatch');
    return bytes;
  }
  const frame = manifest.objects[sha256];
  const pack = manifest.packs.find((entry) => entry.sha256 === frame.packSha256);
  const end = frame.offset + frame.length - 1;
  const response = await fetchImpl(`${baseUrl}/${pack.path}`, {
    headers: { Range: `bytes=${frame.offset}-${end}` },
  });
  if (
    response.status !== 206 ||
    response.headers.get('content-range') !== `bytes ${frame.offset}-${end}/${pack.size}`
  )
    throw new Error('Previous pack Range unsupported');
  const raw = await boundedBody(response, Math.min(frame.length, 256 * 1024 ** 2));
  if (raw.length !== frame.length || hash(raw) !== frame.compressedSha256)
    throw new Error('Previous frame mismatch');
  const bytes = await decompress(raw, { maxOutputLength: 256 * 1024 ** 2 });
  if (hash(bytes) !== sha256) throw new Error('Previous content mismatch');
  return bytes;
}

export async function buildCoreV4({
  channel,
  coreDir,
  outDir,
  platform,
  privateKeyPem,
  seq,
  shellAbi,
  version,
  previousManifest = null,
  previousBaseUrl,
  rollout = 1,
  fetchImpl = fetch,
}) {
  if (!privateKeyPem) throw new Error('private key required');
  if (
    !/^[\w.+-]{1,64}$/.test(version) ||
    version === '.' ||
    version === '..' ||
    !['darwin', 'win32', 'linux'].includes(platform) ||
    !['stable', 'beta', 'canary', 'nightly'].includes(channel) ||
    !/^[0-9a-f]{64}$/.test(shellAbi) ||
    !Number.isSafeInteger(seq) ||
    seq < 0 ||
    !Number.isFinite(rollout) ||
    rollout < 0 ||
    rollout > 1
  )
    throw new Error('Invalid core release metadata');
  const { objects, tree } = readCoreTree(coreDir);
  if (!tree.length || tree.some((file) => file.size > 256 * 1024 ** 2))
    throw new Error('Invalid core file size');
  const old = new Map(previousManifest?.tree.map((file) => [file.path, file.sha256]) ?? []);
  const next = new Map(tree.map((file) => [file.path, file.sha256]));
  const changed = [...new Set([...old.keys(), ...next.keys()])].filter(
    (key) => old.get(key) !== next.get(key),
  );
  if (previousManifest && changed.every((key) => key === 'package.json'))
    throw new EmptyReleaseError();
  const output = path.join(outDir, 'core-v4', platform);
  const encoded = new Map();
  for (const [sha256, bytes] of objects) {
    encoded.set(
      sha256,
      await compress(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }),
    );
  }
  const { index, pack } = await writeCorePack(encoded, output);
  const patchBytes = new Map();
  if (previousManifest) {
    const pairs = pairRendererFiles(
      previousManifest.tree.filter((file) => PATCH_SCOPE.test(file.path)),
      tree.filter((file) => PATCH_SCOPE.test(file.path)),
    );
    for (const pair of pairs) {
      if (pair.kind !== 'patch') continue;
      const key = `${pair.from.sha256}-${pair.to.sha256}`;
      if (patchBytes.has(key)) continue;
      try {
        const base = await previousContent(
          previousManifest,
          pair.from.sha256,
          previousBaseUrl,
          fetchImpl,
        );
        const patch = await generateZstdPatch(base, objects.get(pair.to.sha256));
        if (patch && patch.length < index[pair.to.sha256].length) patchBytes.set(key, patch);
      } catch (error) {
        console.warn(`Skipping optional patch ${key}: ${error.message}`);
      }
    }
  }
  const packs = [pack];
  const patches = [];
  if (patchBytes.size) {
    const built = await writeCorePack(patchBytes, output);
    packs.push(built.pack);
    for (const [key, frame] of Object.entries(built.index)) {
      const [fromSha256, toSha256] = key.split('-');
      patches.push({ ...frame, fromSha256, toSha256 });
    }
  }
  const manifest = signManifest(
    {
      applyMode: previousManifest
        ? changed.every((key) => key.startsWith('dist/renderer/'))
          ? 'reload'
          : 'relaunch'
        : null,
      channel,
      objects: index,
      packs,
      patches,
      platform,
      previous: previousManifest?.version ?? null,
      rollout,
      schemaVersion: 4,
      seq,
      shellAbi,
      tree,
      version,
    },
    privateKeyPem,
  );
  await mkdir(path.join(output, 'versions'), { recursive: true });
  const json = JSON.stringify(manifest, null, 2);
  await writeFile(path.join(output, 'versions', `${version}.json`), json);
  await writeFile(path.join(output, 'latest.json'), json);
  return {
    manifest,
    stats: { objectBytes: pack.size, objectsWritten: objects.size, patches: patches.length },
  };
}
