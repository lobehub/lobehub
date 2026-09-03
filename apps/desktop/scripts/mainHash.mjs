import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.dirname(path.dirname(scriptPath));
const repoRoot = path.dirname(path.dirname(desktopRoot));
const probeEnv = 'RENDERER_OTA_MAIN_HASH_PROBE';
const runningEnv = 'RENDERER_OTA_MAIN_HASH_RUNNING';

export const MAIN_HASH_PLACEHOLDER = '__LOBEMAINHASH_BUNDLE_PROBE__';

const TARGETS = ['main', 'preload'];
const PLATFORMS = ['darwin', 'linux', 'win32'];

const EXTERNALS_TARGET = 'externals';
const EXTERNAL_SOURCE_IGNORED_DIRS = new Set([
  '__mocks__',
  '__tests__',
  'build',
  'dist',
  'node_modules',
  'prebuilds',
]);
const EXTERNAL_SOURCE_IGNORED_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.md$|\.map$/;

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

function walkModuleFiles(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXTERNAL_SOURCE_IGNORED_DIRS.has(entry.name)) {
        walkModuleFiles(path.join(dir, entry.name), files);
      }
    } else if (!EXTERNAL_SOURCE_IGNORED_FILE_RE.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function readModulePackageJson(moduleDir) {
  try {
    return JSON.parse(readFileSync(path.join(moduleDir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function resolveInstalledModuleDir(name, fromDirs) {
  for (const fromDir of fromDirs) {
    let current = fromDir;
    while (true) {
      const candidate = path.join(current, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) return candidate;

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

function updateExternalModuleHash(hash, name, fromDirs, options = {}, visited = new Set()) {
  const moduleDir = resolveInstalledModuleDir(name, fromDirs);
  if (!moduleDir) {
    hash.update(`${name}\0(absent)\0`);
    return;
  }

  const realDir = realpathSync(moduleDir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  const packageJson = readModulePackageJson(realDir);
  const version = packageJson.version ?? '';
  hash.update(`${name}\0${version}\0`);

  // Workspace packages keep the same version across every source change, so a
  // first-party native addon would otherwise ship new main-process code under an
  // unchanged mainHash. Registry packages are immutable per version.
  const isWorkspacePackage =
    realDir.startsWith(`${repoRoot}${path.sep}`) &&
    !realDir.includes(`${path.sep}node_modules${path.sep}`);
  if (isWorkspacePackage) {
    for (const file of walkModuleFiles(realDir).sort()) {
      hash.update(path.relative(realDir, file).replaceAll('\\', '/'));
      hash.update('\0');
      hash.update(readFileSync(file));
      hash.update('\0');
    }
  }

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(options.skipOptionalDependenciesFor?.has(packageJson.name)
      ? {}
      : packageJson.optionalDependencies || {}),
  };
  for (const dependency of Object.keys(dependencies).sort()) {
    updateExternalModuleHash(hash, dependency, [realDir, moduleDir, desktopRoot], options, visited);
  }
}

export async function computeExternalModulesHash(platform) {
  const originalPlatform = process.env.npm_config_platform;
  process.env.npm_config_platform = platform;
  try {
    // Both configs read the target platform at module scope, so each platform
    // needs its own module instance rather than the cached one.
    const [runtimeDeps, nativeDeps] = await Promise.all(
      ['external-runtime-deps.config.mjs', 'native-deps.config.mjs'].map(
        (file) =>
          import(`${pathToFileURL(path.join(desktopRoot, file)).href}?platform=${platform}`),
      ),
    );
    const modules = new Set([...runtimeDeps.externalRuntimeModules, ...nativeDeps.nativeModules]);

    const hash = createHash('sha256');
    for (const name of [...modules].sort()) {
      updateExternalModuleHash(hash, name, [desktopRoot], nativeDeps.dependencyOptions);
    }
    return hash.digest('hex');
  } finally {
    if (originalPlatform === undefined) delete process.env.npm_config_platform;
    else process.env.npm_config_platform = originalPlatform;
  }
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

export function createMainHashFromProbes({ cloudRef, publicKey, runProbe, version }) {
  const bundleHashes = [];

  for (const platform of PLATFORMS) {
    for (const target of TARGETS) {
      bundleHashes.push({ hash: runProbe('--bundle-probe', platform, target), platform, target });
    }
    bundleHashes.push({
      hash: runProbe('--externals-probe', platform, EXTERNALS_TARGET),
      platform,
      target: EXTERNALS_TARGET,
    });
  }

  return createMainHash({
    bundleHashes,
    cloudRef,
    publicKey,
    version,
  });
}

export function computeMainHash() {
  const packageJson = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  const childEnv = { ...process.env, [probeEnv]: '1' };
  delete childEnv.MAIN_HASH;

  const runProbe = (flag, platform, target) => {
    const output = execFileSync(process.execPath, [scriptPath, flag, platform, target], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split(/\r?\n/)
      .at(-1);

    if (!output || !/^[0-9a-f]{64}$/.test(output)) {
      throw new Error(`Invalid ${platform}/${target} hash: ${output ?? '(empty)'}`);
    }
    return output;
  };

  return createMainHashFromProbes({
    cloudRef: process.env.CLOUD_REF,
    publicKey: process.env.RENDERER_OTA_PUBLIC_KEY,
    runProbe,
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
  const probeFlag = ['--bundle-probe', '--externals-probe'].find((flag) =>
    process.argv.includes(flag),
  );

  if (probeFlag) {
    const probeIndex = process.argv.indexOf(probeFlag);
    const platform = process.argv[probeIndex + 1];
    const target = process.argv[probeIndex + 2];
    const validTarget =
      probeFlag === '--bundle-probe' ? TARGETS.includes(target) : target === EXTERNALS_TARGET;
    if (!PLATFORMS.includes(platform) || !validTarget) {
      throw new Error('Probe requires a valid platform and target');
    }
    const probe =
      probeFlag === '--bundle-probe'
        ? computeBundleHash(platform, target)
        : computeExternalModulesHash(platform);
    probe.then(console.log, (error) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else {
    console.log(computeMainHash());
  }
}
