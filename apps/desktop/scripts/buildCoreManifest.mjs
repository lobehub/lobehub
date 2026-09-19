import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRendererTree, signManifest } from './buildRendererManifest.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const CHANNELS = new Set(['stable', 'beta', 'canary', 'nightly']);
const PLATFORMS = new Set(['darwin', 'win32', 'linux']);

export const PLACEHOLDER_OBJECTS_BASE_URL = 'https://core-ota.invalid/cas';
export const PLACEHOLDER_FULL = {
  path: `packs/${'0'.repeat(64)}.zip`,
  sha256: '0'.repeat(64),
  size: 1,
};

const assertManifest = (manifest) => {
  const problems = [];
  if (!CHANNELS.has(manifest.channel)) problems.push(`channel ${manifest.channel}`);
  if (!PLATFORMS.has(manifest.platform)) problems.push(`platform ${manifest.platform}`);
  if (!manifest.version) problems.push('version');
  if (!Number.isInteger(manifest.seq) || manifest.seq < 0) problems.push(`seq ${manifest.seq}`);
  if (!SHA256.test(manifest.shellAbi)) problems.push(`shellAbi ${manifest.shellAbi}`);
  if (manifest.tree.length === 0) problems.push('tree empty');
  if (manifest.tree.some((file) => !SHA256.test(file.sha256))) problems.push('tree sha256');
  if (!URL.canParse(manifest.objectsBaseUrl)) problems.push('objectsBaseUrl');
  if (manifest.full?.path !== `packs/${manifest.full?.sha256}.zip`) problems.push('full');
  if (manifest.rollout < 0 || manifest.rollout > 1) problems.push(`rollout ${manifest.rollout}`);
  if (problems.length) throw new Error(`core manifest invalid: ${problems.join(', ')}`);
};

export const readCoreTree = (coreDir) => {
  const { objects, tree: allFiles } = readRendererTree(coreDir);
  const tree = allFiles.filter((file) => file.path !== 'manifest.json');
  const referenced = new Set(tree.map((file) => file.sha256));
  for (const sha256 of objects.keys()) if (!referenced.has(sha256)) objects.delete(sha256);
  return { objects, tree };
};

export function createCoreManifest({
  applyMode = null,
  channel,
  full,
  objectsBaseUrl,
  patches = [],
  platform,
  previous = null,
  privateKeyPem,
  rollout = 1,
  seq,
  shellAbi,
  tree,
  version,
}) {
  const unsigned = {
    applyMode,
    channel,
    full,
    objectsBaseUrl,
    patches,
    platform,
    previous,
    rollout,
    schemaVersion: 3,
    seq,
    shellAbi,
    tree,
    version,
  };
  assertManifest(unsigned);
  if (privateKeyPem) return signManifest(unsigned, privateKeyPem);
  console.warn('core manifest: no private key, writing unsigned manifest (local dev only)');
  return { ...unsigned, signature: '' };
}

export const writeCoreManifest = (coreDir, manifest) =>
  writeFileSync(path.join(coreDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

export async function buildCoreManifest({
  channel,
  coreDir,
  objectsBaseUrl = PLACEHOLDER_OBJECTS_BASE_URL,
  platform,
  privateKeyPem,
  seq,
  shellAbi,
  version,
}) {
  const manifest = createCoreManifest({
    channel,
    full: PLACEHOLDER_FULL,
    objectsBaseUrl,
    platform,
    privateKeyPem,
    seq,
    shellAbi,
    tree: readCoreTree(coreDir).tree,
    version,
  });
  writeCoreManifest(coreDir, manifest);
  return manifest;
}

export const parseArgs = (argv) =>
  Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => arg.slice(2).split(/=(.*)/s).slice(0, 2)),
  );

export const readPrivateKey = (args) =>
  args['private-key-file']
    ? readFileSync(args['private-key-file'], 'utf8')
    : process.env.RENDERER_OTA_PRIVATE_KEY;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await buildCoreManifest({
    channel: args.channel,
    coreDir: path.resolve(args.core ?? 'core-dist'),
    objectsBaseUrl: args['objects-base-url'],
    platform: args.platform,
    privateKeyPem: readPrivateKey(args),
    seq: Number(args.seq),
    shellAbi: args['shell-abi'],
    version: args.version,
  });
  console.log(
    `core manifest: ${manifest.channel}/${manifest.platform} ${manifest.version} seq ${manifest.seq} (${manifest.tree.length} files, ${manifest.signature ? 'signed' : 'UNSIGNED'})`,
  );
}
