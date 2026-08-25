import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeMainHash } from './mainHash.mjs';

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

function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
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
  const manifest = signManifest(
    buildManifest({ appVersion, mainHash, rendererDir, version }),
    privateKeyPem,
  );

  const casDir = path.join(outDir, 'files');
  mkdirSync(casDir, { recursive: true });
  for (const file of manifest.files) {
    const target = path.join(casDir, `${file.sha256}.bin`);
    try {
      statSync(target);
    } catch {
      copyFileSync(path.join(rendererDir, file.path), target);
    }
  }

  const feedDir = path.join(outDir, channel, mainHash);
  mkdirSync(feedDir, { recursive: true });
  writeFileSync(path.join(feedDir, 'latest.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `renderer-ota manifest: ${channel}/${mainHash}/latest.json (${manifest.files.length} files, version ${version})`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
