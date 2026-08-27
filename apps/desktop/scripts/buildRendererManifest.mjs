import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify as cryptoVerify,
} from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync, zipSync } from 'fflate';

import { computeMainHash } from './mainHash.mjs';
import { candidateDeltaVersions, generateZstdPatch, pairRendererFiles } from './rendererDelta.mjs';

const PACK_COMPRESSION_LEVEL = 9;
const MAX_DELTA_PACK_RATIO = 0.8;
const PACK_METADATA_ENTRY = 'meta.json';
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256Of = (content) => createHash('sha256').update(content).digest('hex');

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

export function readRendererTree(rendererDir) {
  const objects = new Map();
  const tree = walk(rendererDir)
    .map((full) => {
      const content = readFileSync(full);
      const sha256 = sha256Of(content);
      if (!objects.has(sha256)) objects.set(sha256, content);
      return {
        path: path.relative(rendererDir, full).replaceAll('\\', '/'),
        sha256,
        size: content.byteLength,
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return { objects, tree };
}

export function signManifest(manifest, privateKeyPem) {
  const signature = sign(null, Buffer.from(canonicalJson(manifest)), privateKeyPem).toString(
    'base64',
  );
  return { ...manifest, signature };
}

const verifyManifest = (manifest, publicKeyPem) => {
  if (!manifest?.signature) return false;
  const { signature, ...unsigned } = manifest;
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(unsigned)),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
};

export function encodePack(entries) {
  const zippable = {};
  for (const [name, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    zippable[name] = [
      new Uint8Array(entry.content),
      { level: entry.store ? 0 : PACK_COMPRESSION_LEVEL, mtime: ZIP_EPOCH },
    ];
  }
  return Buffer.from(zipSync(zippable, { level: PACK_COMPRESSION_LEVEL, mtime: ZIP_EPOCH }));
}

export function decodePack(content) {
  return new Map(
    Object.entries(unzipSync(new Uint8Array(content))).map(([name, value]) => [
      name,
      Buffer.from(value),
    ]),
  );
}

const packArtifact = (content) => {
  const sha256 = sha256Of(content);
  return { path: `packs/${sha256}.zip`, sha256, size: content.byteLength };
};

const writePack = async (feedDir, content) => {
  const artifact = packArtifact(content);
  const target = path.join(feedDir, artifact.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return artifact;
};

const withPackMetadata = (entries, metadata) =>
  new Map([
    [PACK_METADATA_ENTRY, { content: Buffer.from(canonicalJson(metadata)), store: false }],
    ...entries,
  ]);

const fullPackEntries = (objects, metadata) =>
  withPackMetadata(
    new Map(
      [...objects].map(([sha256, content]) => [`objects/${sha256}`, { content, store: false }]),
    ),
    metadata,
  );

export async function buildDelta({ fromTree, fromVersion, resolveFromContent, toDir, toTree }) {
  const entries = new Map();
  const objects = new Set();
  const patchesByTarget = new Map();
  const fromHashes = new Set(fromTree.map((file) => file.sha256));

  const addObject = (file) => {
    if (fromHashes.has(file.sha256) || objects.has(file.sha256)) return;
    const content = readFileSync(path.join(toDir, file.path));
    objects.add(file.sha256);
    entries.set(`objects/${file.sha256}`, { content, store: false });
  };

  for (const pairing of pairRendererFiles(fromTree, toTree)) {
    if (pairing.kind === 'copy') continue;
    if (pairing.kind === 'full') {
      addObject(pairing.to);
      continue;
    }

    const oldContent = await resolveFromContent(pairing.from);
    const newContent = readFileSync(path.join(toDir, pairing.to.path));
    const patch = await generateZstdPatch(oldContent, newContent);
    if (!patch) {
      addObject(pairing.to);
      continue;
    }

    const patchSha256 = sha256Of(patch);
    entries.set(`patches/${patchSha256}`, { content: patch, store: true });
    patchesByTarget.set(pairing.to.sha256, {
      fromSha256: pairing.from.sha256,
      patchSha256,
      toSha256: pairing.to.sha256,
    });
  }

  return {
    delta: {
      fromVersion,
      objects: [...objects].sort(),
      patches: [...patchesByTarget.values()].sort((a, b) => a.toSha256.localeCompare(b.toSha256)),
    },
    entries,
  };
}

const fetchJson = async (url) => {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`fetch ${url} failed: ${response.status}`);
  return response.json();
};

const assertBaseManifest = (manifest, publicKeyPem, label) => {
  if (
    manifest?.schemaVersion !== 2 ||
    !manifest.full?.path ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error(`Renderer OTA V2 base manifest invalid: ${label}`);
  }
  if (!verifyManifest(manifest, publicKeyPem)) {
    throw new Error(`Renderer OTA V2 base signature invalid: ${label}`);
  }
};

const readFullPackMetadata = (entries, version, label) => {
  const raw = entries.get(PACK_METADATA_ENTRY);
  let metadata;
  try {
    metadata = JSON.parse(raw?.toString('utf8') ?? '');
  } catch {
    throw new Error(`Renderer OTA V2 full pack metadata invalid: ${label}`);
  }
  if (
    metadata?.packVersion !== 1 ||
    metadata.kind !== 'full' ||
    metadata.version !== version ||
    !Array.isArray(metadata.tree) ||
    metadata.tree.length === 0
  ) {
    throw new Error(`Renderer OTA V2 full pack metadata invalid: ${label}`);
  }
  return metadata;
};

const readArtifact = async (source, artifact) => {
  let content;
  if (source.kind === 'url') {
    const response = await fetch(`${source.root}/${artifact.path}`);
    if (!response.ok) throw new Error(`fetch ${artifact.path} failed: ${response.status}`);
    content = Buffer.from(await response.arrayBuffer());
  } else {
    content = await readFile(path.join(source.root, artifact.path));
  }
  if (content.byteLength !== artifact.size || sha256Of(content) !== artifact.sha256) {
    throw new Error(`Renderer OTA V2 pack integrity mismatch: ${artifact.path}`);
  }
  return content;
};

const hydrateBase = async (base) => {
  if (base.kind === 'directory') {
    return {
      resolveFromContent: async (file) => readFile(path.join(base.root, file.path)),
      tree: readRendererTree(base.root).tree,
      version: base.version,
    };
  }

  const entries = decodePack(await readArtifact(base.source, base.manifest.full));
  const metadata = readFullPackMetadata(entries, base.manifest.version, base.manifest.full.path);
  const expectedEntries = new Set([
    PACK_METADATA_ENTRY,
    ...metadata.tree.map((file) => `objects/${file.sha256}`),
  ]);
  if (
    entries.size !== expectedEntries.size ||
    [...entries.keys()].some((name) => !expectedEntries.has(name))
  ) {
    throw new Error(`Renderer OTA V2 full pack entries invalid: ${base.manifest.full.path}`);
  }
  for (const file of metadata.tree) {
    const content = entries.get(`objects/${file.sha256}`);
    if (!content || sha256Of(content) !== file.sha256) {
      throw new Error(`Renderer OTA V2 full pack missing ${file.path}`);
    }
  }
  return {
    resolveFromContent: async (file) => entries.get(`objects/${file.sha256}`),
    tree: metadata.tree,
    version: base.manifest.version,
  };
};

export async function loadDeltaBases({
  feedUrl,
  fromDir,
  fromManifests,
  fromVersion,
  publicKeyPem,
  version,
}) {
  if (fromDir) {
    return [{ kind: 'directory', root: fromDir, version: fromVersion ?? 'r0' }];
  }

  const snapshots = [];
  const seen = new Set();
  const add = (manifest, source, label) => {
    if (!manifest || seen.has(manifest.version)) return;
    assertBaseManifest(manifest, publicKeyPem, label);
    seen.add(manifest.version);
    snapshots.push({ kind: 'manifest', manifest, source });
  };

  for (const filePath of fromManifests) {
    const absolute = path.resolve(filePath);
    const manifestDir = path.dirname(absolute);
    const feedRoot =
      path.basename(manifestDir) === 'versions' ? path.dirname(manifestDir) : manifestDir;
    add(JSON.parse(readFileSync(absolute, 'utf8')), { kind: 'file', root: feedRoot }, absolute);
  }

  if (feedUrl) {
    const feed = feedUrl.replace(/\/$/, '');
    const source = { kind: 'url', root: feed };
    add(await fetchJson(`${feed}/latest.json`), source, `${feed}/latest.json`);
    for (const target of candidateDeltaVersions(version)) {
      if (seen.has(target)) continue;
      add(
        await fetchJson(`${feed}/versions/${target}.json`),
        source,
        `${feed}/versions/${target}.json`,
      );
    }
  }

  const selected = new Set(candidateDeltaVersions(version));
  return snapshots.filter((snapshot) => selected.has(snapshot.manifest.version));
}

async function main() {
  const fromManifests = [];
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => {
        const [key, value] = arg.slice(2).split('=');
        if (key === 'from-manifest' && value) fromManifests.push(value);
        return [key, value ?? true];
      }),
  );

  if (args['gen-key']) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    console.log(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
    console.log(publicKey.export({ format: 'pem', type: 'spki' }).toString());
    return;
  }

  const rendererDir = path.resolve(args.renderer ?? 'dist/renderer');
  const outDir = path.resolve(args.out ?? 'release/renderer-ota');
  const channel = args.channel ?? process.env.UPDATE_CHANNEL ?? 'nightly';
  const version = args.version;
  const appVersion =
    args.appVersion ??
    JSON.parse(
      readFileSync(
        path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'package.json'),
        'utf8',
      ),
    ).version;
  const privateKeyPem = process.env.RENDERER_OTA_PRIVATE_KEY;

  if (!version || !/^r\d+$/.test(version)) throw new Error('--version=r<N> is required');
  if (!privateKeyPem) throw new Error('RENDERER_OTA_PRIVATE_KEY env is required');

  const publicKeyPem = createPublicKey(privateKeyPem)
    .export({ format: 'pem', type: 'spki' })
    .toString();
  const feedDir = path.join(outDir, channel, appVersion, 'renderer', 'v2');
  const mainHash = args.mainHash ?? computeMainHash();
  const { objects, tree } = readRendererTree(rendererDir);
  const fullMetadata = { kind: 'full', packVersion: 1, tree, version };
  const fullPack = encodePack(fullPackEntries(objects, fullMetadata));
  const full = await writePack(feedDir, fullPack);
  const unsigned = { appVersion, full, mainHash, schemaVersion: 2, version };

  const bases = await loadDeltaBases({
    feedUrl: args['feed-url'],
    fromDir: args['from-dir'] ? path.resolve(args['from-dir']) : null,
    fromManifests,
    fromVersion: args['from-version'],
    publicKeyPem,
    version,
  });

  if (bases.length > 0) {
    unsigned.deltas = [];
    for (const sourceBase of bases) {
      const base = await hydrateBase(sourceBase);
      const { delta, entries } = await buildDelta({
        fromTree: base.tree,
        fromVersion: base.version,
        resolveFromContent: base.resolveFromContent,
        toDir: rendererDir,
        toTree: tree,
      });
      const deltaMetadata = {
        ...delta,
        kind: 'delta',
        packVersion: 1,
        tree,
        version,
      };
      const content = encodePack(withPackMetadata(entries, deltaMetadata));
      if (content.byteLength >= full.size * MAX_DELTA_PACK_RATIO) {
        console.log(`renderer-ota delta ${base.version} -> ${version}: skipped (not efficient)`);
        continue;
      }
      const pack = await writePack(feedDir, content);
      unsigned.deltas.push({ fromVersion: base.version, pack });
      console.log(
        `renderer-ota delta ${base.version} -> ${version}: ${(content.byteLength / 1048576).toFixed(2)} MB vs ${(full.size / 1048576).toFixed(2)} MB full`,
      );
    }
  }

  const manifest = signManifest(unsigned, privateKeyPem);
  await mkdir(path.join(feedDir, 'versions'), { recursive: true });
  await writeFile(
    path.join(feedDir, 'versions', `${version}.json`),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(path.join(feedDir, 'latest.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `renderer-ota v2 manifest: ${channel}/${appVersion}/renderer/v2/latest.json (${tree.length} files, version ${version})`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
