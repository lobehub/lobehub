import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

import { computeMainHash } from './mainHash.mjs';
import { candidateDeltaVersions, generateZstdPatch, pairRendererFiles } from './rendererDelta.mjs';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

export function buildManifest({ rendererDir, version, appVersion, mainHash }) {
  const files = walk(rendererDir)
    .map((full) => {
      const content = readFileSync(full);
      return {
        path: path.relative(rendererDir, full).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.byteLength,
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  return { appVersion, files, mainHash, version };
}

export function signManifest(manifest, privateKeyPem) {
  const signature = sign(null, Buffer.from(canonicalJson(manifest)), privateKeyPem).toString(
    'base64',
  );
  return { ...manifest, signature };
}

const sha256Of = (content) => createHash('sha256').update(content).digest('hex');
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const isGzipPayload = (buf) => buf.byteLength >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

const encodeCasPayload = async (raw) => Buffer.from(await gzipAsync(raw, { level: 9 }));

const decodeCasPayload = async (buf) =>
  isGzipPayload(buf) ? Buffer.from(await gunzipAsync(buf)) : buf;

const writeCasObject = async (casDir, sha256, raw) => {
  mkdirSync(casDir, { recursive: true });
  await writeFile(path.join(casDir, `${sha256}.bin`), await encodeCasPayload(raw));
};

const readTreeEntries = (dir) =>
  walk(dir)
    .map((full) => {
      const content = readFileSync(full);
      return {
        path: path.relative(dir, full).replaceAll('\\', '/'),
        sha256: sha256Of(content),
        size: content.byteLength,
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));

export async function buildDelta({ fromFiles, fromVersion, resolveFromPath, toDir, toFiles }) {
  const pairings = pairRendererFiles(fromFiles, toFiles);

  const patches = new Map();
  const ops = [];

  for (const pairing of pairings) {
    if (pairing.kind === 'copy') {
      ops.push({ op: 'copy', path: pairing.to.path, sha256: pairing.to.sha256 });
      continue;
    }

    if (pairing.kind === 'full') {
      ops.push({
        op: 'full',
        path: pairing.to.path,
        sha256: pairing.to.sha256,
        size: pairing.to.size,
      });
      continue;
    }

    const oldFull = await resolveFromPath(pairing.from);
    const newFull = path.join(toDir, pairing.to.path);
    const patch = await generateZstdPatch(oldFull, newFull, pairing.to.size);
    if (!patch) {
      ops.push({
        op: 'full',
        path: pairing.to.path,
        sha256: pairing.to.sha256,
        size: pairing.to.size,
      });
      continue;
    }

    const patchSha256 = sha256Of(patch);
    patches.set(patchSha256, patch);
    ops.push({
      fromSha256: pairing.from.sha256,
      op: 'patch',
      patchSha256,
      patchSize: patch.byteLength,
      path: pairing.to.path,
      sha256: pairing.to.sha256,
      size: pairing.to.size,
    });
  }

  const downloadedBytes = ops.reduce((sum, op) => {
    if (op.op === 'patch') return sum + op.patchSize;
    if (op.op === 'full') return sum + op.size;
    return sum;
  }, 0);
  const fullBytes = toFiles.reduce((sum, file) => sum + file.size, 0);

  return {
    delta: { fromVersion, ops },
    downloadedBytes,
    fullBytes,
    patches,
  };
}

const fetchJson = async (url) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return res.json();
};

const createCasResolver = (casBaseUrl, cacheDir) => {
  const base = casBaseUrl.replace(/\/$/, '');
  const cache = new Map();
  return async (file) => {
    const hit = cache.get(file.sha256);
    if (hit) return hit;
    const dest = path.join(cacheDir, `${file.sha256}.bin`);
    await mkdir(path.dirname(dest), { recursive: true });
    const res = await fetch(`${base}/${file.sha256}.bin`);
    if (!res.ok) throw new Error(`hydrate ${file.path} failed: ${res.status}`);
    await writeFile(dest, await decodeCasPayload(Buffer.from(await res.arrayBuffer())));
    cache.set(file.sha256, dest);
    return dest;
  };
};

export async function loadDeltaBases({
  casBaseUrl,
  feedUrl,
  fromDir,
  fromManifests,
  fromVersion,
  version,
}) {
  if (fromDir) {
    return {
      bases: [
        {
          files: readTreeEntries(fromDir),
          resolveFromPath: async (file) => path.join(fromDir, file.path),
          version: fromVersion ?? 'r0',
        },
      ],
      cacheDir: null,
    };
  }

  const snapshots = [];
  const seen = new Set();
  const add = (manifest) => {
    if (!manifest?.version || !Array.isArray(manifest.files) || seen.has(manifest.version)) return;
    seen.add(manifest.version);
    snapshots.push(manifest);
  };

  for (const filePath of fromManifests) {
    add(JSON.parse(readFileSync(path.resolve(filePath), 'utf8')));
  }

  if (feedUrl) {
    const feed = feedUrl.replace(/\/$/, '');
    add(await fetchJson(`${feed}/latest.json`));
    for (const target of candidateDeltaVersions(version)) {
      if (seen.has(target)) continue;
      add(await fetchJson(`${feed}/versions/${target}.json`));
    }
  }

  const selected = new Set(candidateDeltaVersions(version));
  const bases = snapshots.filter((manifest) => selected.has(manifest.version));
  if (bases.length === 0) return { bases: [], cacheDir: null };
  if (!casBaseUrl) {
    throw new Error('--cas-base-url is required to build deltas from manifests');
  }

  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'renderer-cas-'));
  const resolveFromPath = createCasResolver(casBaseUrl, cacheDir);

  return {
    bases: bases.map((manifest) => ({
      files: manifest.files,
      resolveFromPath,
      version: manifest.version,
    })),
    cacheDir,
  };
}

async function main() {
  const fromManifests = [];
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        if (k === 'from-manifest' && v) fromManifests.push(v);
        return [k, v ?? true];
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

  if (!version) throw new Error('--version=r<N> is required');
  if (!privateKeyPem) throw new Error('RENDERER_OTA_PRIVATE_KEY env is required');

  const mainHash = args.mainHash ?? computeMainHash();
  const unsigned = buildManifest({ appVersion, mainHash, rendererDir, version });
  const { rm } = await import('node:fs/promises');

  const { bases, cacheDir } = await loadDeltaBases({
    casBaseUrl: args['cas-base-url'],
    feedUrl: args['feed-url'],
    fromDir: args['from-dir'] ? path.resolve(args['from-dir']) : null,
    fromManifests,
    fromVersion: args['from-version'],
    version,
  });

  if (bases.length > 0) {
    unsigned.deltas = [];
    const casDir = path.join(outDir, 'files');
    for (const base of bases) {
      const { delta, downloadedBytes, fullBytes, patches } = await buildDelta({
        fromFiles: base.files,
        fromVersion: base.version,
        resolveFromPath: base.resolveFromPath,
        toDir: rendererDir,
        toFiles: unsigned.files,
      });
      unsigned.deltas.push(delta);
      for (const [sha256, patch] of patches) {
        await writeCasObject(casDir, sha256, patch);
      }
      console.log(
        `renderer-ota delta ${base.version} -> ${version}: ${(downloadedBytes / 1048576).toFixed(2)} MB download vs ${(fullBytes / 1048576).toFixed(2)} MB full`,
      );
    }
  }

  if (cacheDir) await rm(cacheDir, { force: true, recursive: true });

  const manifest = signManifest(unsigned, privateKeyPem);

  const casDir = path.join(outDir, 'files');
  mkdirSync(casDir, { recursive: true });
  for (const file of manifest.files) {
    const target = path.join(casDir, `${file.sha256}.bin`);
    try {
      if (isGzipPayload(readFileSync(target))) continue;
    } catch {
      /* missing */
    }
    await writeCasObject(casDir, file.sha256, readFileSync(path.join(rendererDir, file.path)));
  }

  const feedDir = path.join(outDir, channel, mainHash);
  mkdirSync(path.join(feedDir, 'versions'), { recursive: true });
  writeFileSync(path.join(feedDir, 'latest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    path.join(feedDir, 'versions', `${version}.json`),
    JSON.stringify({ files: unsigned.files, version }, null, 2),
  );

  console.log(
    `renderer-ota manifest: ${channel}/${mainHash}/latest.json (${manifest.files.length} files, version ${version})`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
