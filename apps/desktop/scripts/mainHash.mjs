import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.dirname(path.dirname(scriptPath));
const repoRoot = path.dirname(path.dirname(desktopRoot));
const probeEnv = 'RENDERER_OTA_MAIN_HASH_PROBE';
const runningEnv = 'RENDERER_OTA_MAIN_HASH_RUNNING';

export const MAIN_HASH_PLACEHOLDER = '__LOBEMAINHASH_BUNDLE_PROBE__';

const TARGETS = ['main', 'preload'];
const PLATFORMS = ['darwin', 'linux', 'win32'];

const bundleOutputs = (result) =>
  (Array.isArray(result) ? result : [result]).flatMap((item) => item.output ?? []);

export async function computeBundleHash(platform, target) {
  const { build } = await import('vite');
  const hash = createHash('sha256');
  const originalPlatform = process.env.npm_config_platform;
  const originalProbe = process.env[probeEnv];
  const originalRunning = process.env[runningEnv];
  const originalInfo = console.info;

  process.env[probeEnv] = '1';
  process.env[runningEnv] = '1';
  process.env.npm_config_platform = platform;
  console.info = () => {};
  try {
    const result = await build({
      build: { sourcemap: false, write: false },
      configFile: path.join(desktopRoot, `vite.${target}.config.ts`),
      logLevel: 'silent',
      mode: 'production',
    });

    for (const output of bundleOutputs(result).sort((a, b) =>
      a.fileName.localeCompare(b.fileName),
    )) {
      hash.update(`${output.fileName}\0`);
      hash.update(output.type === 'chunk' ? output.code : output.source);
      hash.update('\0');
    }
  } finally {
    console.info = originalInfo;
    if (originalPlatform === undefined) delete process.env.npm_config_platform;
    else process.env.npm_config_platform = originalPlatform;
    if (originalProbe === undefined) delete process.env[probeEnv];
    else process.env[probeEnv] = originalProbe;
    if (originalRunning === undefined) delete process.env[runningEnv];
    else process.env[runningEnv] = originalRunning;
  }

  return hash.digest('hex');
}

export function createMainHash({ bundleHashes, cloudRef = '', publicKey = '', version }) {
  const hash = createHash('sha256');
  hash.update(`version\0${version}\0`);
  hash.update(`cloud-ref\0${cloudRef}\0`);
  hash.update(`renderer-ota-public-key\0${publicKey}\0`);
  for (const { hash: bundleHash, platform, target } of bundleHashes) {
    hash.update(`${platform}/${target}\0${bundleHash}\0`);
  }
  return hash.digest('hex');
}

export function computeMainHash() {
  const packageJson = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  const childEnv = { ...process.env, [probeEnv]: '1' };
  const bundleHashes = [];
  delete childEnv.MAIN_HASH;

  for (const platform of PLATFORMS) {
    for (const target of TARGETS) {
      const output = execFileSync(
        process.execPath,
        [scriptPath, '--bundle-probe', platform, target],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
        .trim()
        .split(/\r?\n/)
        .at(-1);

      if (!output || !/^[0-9a-f]{64}$/.test(output)) {
        throw new Error(`Invalid ${platform}/${target} bundle hash: ${output ?? '(empty)'}`);
      }
      bundleHashes.push({ hash: output, platform, target });
    }
  }

  return createMainHash({
    bundleHashes,
    cloudRef: process.env.CLOUD_REF,
    publicKey: process.env.RENDERER_OTA_PUBLIC_KEY,
    version: packageJson.version,
  });
}

export function resolveMainHash() {
  if (process.env[probeEnv] === '1') return MAIN_HASH_PLACEHOLDER;
  if (!process.env.MAIN_HASH) return computeMainHash();
  if (!/^[0-9a-f]{64}$/.test(process.env.MAIN_HASH)) {
    throw new Error('MAIN_HASH must be a 64-character lowercase SHA-256');
  }
  return process.env.MAIN_HASH;
}

export const rendererMainHashArtifact = (mainHash) => ({
  name: 'renderer-main-hash-artifact',
  writeBundle() {
    const releaseDir = path.join(desktopRoot, 'release');
    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(path.join(releaseDir, 'renderer-mainhash.txt'), `${mainHash}\n`);
  },
});

if (process.argv[1] === scriptPath && process.env[runningEnv] !== '1') {
  if (process.argv.includes('--bundle-probe')) {
    const probeIndex = process.argv.indexOf('--bundle-probe');
    const platform = process.argv[probeIndex + 1];
    const target = process.argv[probeIndex + 2];
    if (!PLATFORMS.includes(platform) || !TARGETS.includes(target)) {
      throw new Error('Bundle probe requires a valid platform and target');
    }
    computeBundleHash(platform, target).then(console.log, (error) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else {
    console.log(computeMainHash());
  }
}
