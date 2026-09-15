import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createModuleRecord, moduleRequests, parseModule, walkGraph } from './mainHashGraph.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '../../..');
const collectEnv = 'RENDERER_OTA_COLLECT_INPUTS';
export const MAIN_HASH_PLACEHOLDER = '__LOBEMAINHASH_SOURCE_GRAPH__';
export const MAIN_HASH_ALGORITHM = 'graph-v2';

// A workspace with platform-dependent imports can opt into whole-source hashing.
// Keep this list in source control: every build and OTA gate must use the same scope.
// napi-loader is bundled on Linux/Windows but externalized with the macOS addon.
export const wholeSourcePackages = ['packages/napi-loader'];

const excluded = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/release/**',
  '**/prebuilds/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/fixtures/**',
  '**/.git/**',
  '**/resources/bin/**',
  '**/resources/cli-package.json',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.md',
  '**/*.mdx',
  '**/*.map',
  '**/*.node',
];
const textFile =
  /\.(?:[cm]?[jt]sx?|json|ya?ml|gypi?|mm?|cc|cpp|c|h|hpp|swift|html|css|svg|sh|txt)$/i;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const slash = (value) => value.replaceAll('\\', '/');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};
const stableJson = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

export function lockedPackages(lockfile) {
  const locked = new Set();
  let inPackages = false;
  for (const line of lockfile.split('\n')) {
    if (/^\S/.test(line)) inPackages = line.startsWith('packages:');
    const key = inPackages && line.match(/^ {2}'?(\S+?)'?:\s*$/)?.[1];
    if (key) locked.add(key);
  }
  return locked;
}

export function createInputManifest(inputs) {
  const sorted = [...inputs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (new Set(sorted.map((input) => input.path)).size !== sorted.length) {
    throw new Error('Duplicate main hash input path');
  }
  return {
    algorithm: MAIN_HASH_ALGORITHM,
    inputs: sorted,
    mainHash: sha256(stableJson({ algorithm: MAIN_HASH_ALGORITHM, inputs: sorted })),
  };
}

/** Capture pre-render code and final retention; chunk-generated names never enter the hash. */
export async function collectViteGraph(options) {
  const { build, parseSync } = await import('vite');
  const nodes = new Map();
  const configFiles = new Set();
  let defines;
  await build({
    ...options,
    build: { ...options.build, minify: false, sourcemap: false, write: false },
    logLevel: 'silent',
    plugins: [
      ...(options.plugins ?? []),
      {
        name: 'renderer-ota-source-inputs',
        configResolved(config) {
          for (const file of config.configFileDependencies) configFiles.add(file);
          defines = config.define;
        },
        async generateBundle(_options, bundle) {
          const retained = new Set(
            Object.values(bundle).flatMap((chunk) =>
              chunk.type === 'chunk' ? Object.keys(chunk.modules) : [],
            ),
          );
          for (const id of this.getModuleIds()) {
            const info = this.getModuleInfo(id);
            const owned = !slash(id).includes('/node_modules/') && !info.isExternal;
            if (owned && retained.has(id) && info.code == null) {
              throw new Error(`Missing transformed code for retained main hash module: ${id}`);
            }
            const ast =
              owned && info.code != null ? parseModule(info.code, id, parseSync) : undefined;
            const resolutions = {};
            if (ast) {
              for (const source of moduleRequests(ast)) {
                const resolved = await this.resolve(source, id);
                if (!resolved) throw new Error(`Unresolved main hash input ${source} in ${id}`);
                resolutions[source] = resolved.id;
              }
            }
            nodes.set(id, {
              id,
              ast,
              resolutions,
              entry: info.isEntry,
              external: info.isExternal,
              inputFormat: info.inputFormat,
              exports: info.exports,
              imports: info.importedIds,
              dynamicImports: info.dynamicallyImportedIds,
              retained: retained.has(id),
            });
          }
        },
      },
    ],
  });
  return { configFiles: [...configFiles], defines, nodes };
}

export async function collectSourceInputs({
  repoRoot = defaultRoot,
  cloudRoot,
  graph = [],
  sourcePackages = wholeSourcePackages,
  publicKey = process.env.RENDERER_OTA_PUBLIC_KEY ?? '',
} = {}) {
  repoRoot = await realpath(repoRoot);
  if (cloudRoot) cloudRoot = await realpath(cloudRoot);
  const inputs = new Map();
  const addValue = (name, value, group) =>
    inputs.set(name, { group, path: name, sha256: sha256(value) });
  const roots = [['oss', repoRoot], ...(cloudRoot ? [['cloud', cloudRoot]] : [])];

  const addFile = async (file, group) => {
    // Queries identify Vite transforms, not a different source file.
    if (file.startsWith('\0')) return;
    file = file.split('?')[0];
    if (!path.isAbsolute(file)) return;
    file = await realpath(file);
    if (slash(file).includes('/node_modules/')) return;
    const owner = roots.find(([, root]) => inside(root, file));
    if (!owner) throw new Error(`Main hash input is outside the source roots: ${file}`);
    if (!(await stat(file)).isFile()) return;
    const [prefix, root] = owner;
    const name = `${prefix}/${slash(path.relative(root, file))}`;
    const bytes = await readFile(file);
    // JSON key order affects exports conditions and runtime iteration; preserve source order.
    const content = textFile.test(file) ? bytes.toString('utf8').replaceAll('\r\n', '\n') : bytes;
    addValue(name, content, group);
  };
  const addTree = async (root, relative, group) => {
    const dir = path.resolve(root, relative);
    if (!inside(root, dir)) throw new Error(`Invalid source directory: ${relative}`);
    await stat(dir); // Missing declared inputs must not silently produce a compatible hash.
    for await (const file of glob(`${slash(relative)}/**/*`, { cwd: root, exclude: excluded })) {
      await addFile(path.join(root, file), group);
    }
  };

  const sourceFile = (id) => id.replace(/^\0/, '').split('?')[0];
  // The lockfile is the only dependency input to the hash, so every bundled npm module
  // must resolve to a version it pins, wherever pnpm happened to link it from.
  let locked;
  const packageIdentity = async (file) => {
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
      try {
        const { name, version } = JSON.parse(
          await readFile(path.join(dir, 'package.json'), 'utf8'),
        );
        if (name && version) return `${name}@${version}`;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (dir === path.dirname(dir)) return undefined;
    }
  };
  for (const target of graph) {
    for (const id of target.nodes.keys()) {
      const file = sourceFile(id);
      if (!path.isAbsolute(file) || !slash(file).includes('/node_modules/')) continue;
      locked ??= lockedPackages(
        await readFile(path.join(repoRoot, 'apps/desktop/pnpm-lock.yaml'), 'utf8'),
      );
      const dependency = await packageIdentity(await realpath(file));
      const name = dependency?.slice(0, dependency.lastIndexOf('@'));
      // Tarball, git, file: and link: specifiers pin by resolution instead of version.
      const pinned =
        dependency &&
        (locked.has(dependency) ||
          [...locked].some(
            (key) => key.startsWith(`${name}@`) && /^[a-z+]+:/.test(key.slice(name.length + 1)),
          ));
      if (!pinned) {
        throw new Error(
          `Main hash dependency is not pinned by apps/desktop/pnpm-lock.yaml: ${dependency ?? 'unknown'} (${file})`,
        );
      }
    }
  }
  const identity = (id) => {
    let normalized = slash(id);
    for (const [prefix, root] of roots) normalized = normalized.replaceAll(slash(root), prefix);
    return normalized;
  };
  const sourceRoots = new Map();
  for (const relative of sourcePackages)
    sourceRoots.set(path.join(repoRoot, relative), 'workspace');
  for (const [, root] of roots) {
    for await (const binding of glob('packages/*/binding.gyp', { cwd: root })) {
      sourceRoots.set(path.join(root, path.dirname(binding)), 'native');
    }
  }
  const inSourceTree = (id) => [...sourceRoots.keys()].some((dir) => inside(dir, sourceFile(id)));
  const families = new Map();
  for (const target of graph) {
    for (const id of target.nodes.keys()) {
      const file = sourceFile(id);
      if (!path.isAbsolute(file) || slash(file).includes('/node_modules/')) continue;
      const base = file.replace(/\.(mac|linux|windows)(?=\.[^.]+$)/, '');
      const ext = path.extname(base);
      if (!/\.[cm]?[jt]sx?$/.test(ext)) continue;
      const variants = [];
      for (const suffix of ['', '.mac', '.linux', '.windows']) {
        const variant = base.slice(0, -ext.length) + suffix + ext;
        try {
          if ((await stat(variant)).isFile()) variants.push(variant);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (variants.some((variant) => variant !== base)) {
        for (const variant of variants) {
          families.set(variant, base);
          await addFile(variant, 'platform');
        }
      }
    }
  }
  const diagnostics = [];
  for (const [index, target] of graph.entries()) {
    const label = target.label ?? (index === 0 ? 'main' : 'preload');
    const nodes = target.nodes;
    const boundaries = new Set(
      [...nodes.keys()].filter((id) => families.has(sourceFile(id)) || inSourceTree(id)),
    );
    const common = walkGraph(
      nodes,
      [...nodes.values()].filter((node) => node.entry).map((node) => node.id),
      boundaries,
    );
    const exclusive = new Set([...walkGraph(nodes, boundaries)].filter((id) => !common.has(id)));
    const opaque = (id, source) => {
      const file = sourceFile(id);
      if (families.has(file)) return `platform:${identity(families.get(file))}`;
      if (inSourceTree(id)) return `source:${source ?? identity(file)}`;
      if (
        !nodes.has(id) &&
        path.isAbsolute(file) &&
        !slash(file).includes('/node_modules/') &&
        roots.some(([, root]) => inside(root, file))
      ) {
        throw new Error(
          `Runtime source is outside the Vite graph; declare its package in wholeSourcePackages: ${file}`,
        );
      }
      if (slash(id).includes('/node_modules/') || !nodes.has(id) || nodes.get(id)?.external)
        return `package:${source ?? id}`;
      if (exclusive.has(id)) return `platform:${identity(file)}`;
      return undefined;
    };
    const summary = [];
    for (const [id, node] of nodes) {
      const file = sourceFile(id);
      if (slash(id).includes('/node_modules/') || node.external) continue;
      if (path.isAbsolute(file)) {
        let dir = path.dirname(await realpath(file));
        const owner = roots.find(([, root]) => inside(root, dir));
        if (!owner) throw new Error(`Main hash input is outside the source roots: ${file}`);
        while (dir !== owner[1]) {
          try {
            await addFile(path.join(dir, 'package.json'), 'config');
            break;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          dir = path.dirname(dir);
        }
      }
      if (exclusive.has(id) || inSourceTree(id)) {
        if (path.isAbsolute(file)) await addFile(file, 'platform');
        continue;
      }
      if (!node.retained || !node.ast) continue;
      const record = createModuleRecord(node, { nodes, identity, opaque });
      const name = `$graph/${label}/${identity(id)}`;
      addValue(name, stableJson(record), 'runtime');
      summary.push({
        id: identity(id),
        retained: true,
        sha256: inputs.get(name).sha256,
        bindings: record.bindings,
        dynamicBindings: record.dynamicBindings,
        effects: record.effects,
        inlined: Object.keys(record.inlined),
        fallback: Object.keys(record.fallback),
      });
    }
    diagnostics.push({
      label,
      nodes: [...nodes.values()]
        .map((node) => ({
          id: identity(node.id),
          imports: node.imports.map(identity),
          dynamicImports: node.dynamicImports.map(identity),
          retained: node.retained,
          boundary: opaque(node.id)
            ? exclusive.has(node.id)
              ? 'platform'
              : 'dependency'
            : undefined,
          codeHash: node.ast ? sha256(stableJson(node.ast)) : undefined,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      modules: summary.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    });
    for (const file of target.configFiles) await addFile(file, 'config');
    addValue(`$defines/${label}`, stableJson(target.defines ?? {}), 'config');
  }
  for (const [dir, group] of sourceRoots) {
    const owner = roots.find(([, root]) => inside(root, dir));
    await addTree(owner[1], path.relative(owner[1], dir), group);
  }
  await addTree(repoRoot, 'apps/desktop/resources', 'desktop');
  for (const [prefix, root] of roots) {
    // Cloud's plugin helpers are loaded at config time, outside the application graph.
    if (prefix === 'cloud') {
      await addTree(root, 'scripts/cloud-desktop', 'config');
      // Overlay runtime/build dependencies (e.g. Sentry) are declared outside Desktop.
      const { dependencies, devDependencies, optionalDependencies } = JSON.parse(
        await readFile(path.join(root, 'package.json'), 'utf8'),
      );
      addValue(
        '$cloud-dependencies',
        stableJson({ dependencies, devDependencies, optionalDependencies }),
        'dependencies',
      );
    }
  }
  for (const file of [
    'apps/desktop/package.json',
    'apps/desktop/pnpm-lock.yaml',
    'apps/desktop/pnpm-workspace.yaml',
    'apps/desktop/vite.main.config.ts',
    'apps/desktop/vite.preload.config.ts',
    'apps/desktop/vite.shared.ts',
    'apps/desktop/tsconfig.json',
    'apps/desktop/native-deps.config.mjs',
    'apps/desktop/external-runtime-deps.config.mjs',
    'apps/desktop/module-deps.config.mjs',
    'apps/desktop/scripts/mainHash.mjs',
    'apps/desktop/scripts/mainHashGraph.mjs',
  ]) {
    await addFile(
      path.join(repoRoot, file),
      file.endsWith('pnpm-lock.yaml') ? 'dependencies' : 'config',
    );
  }
  await addTree(repoRoot, 'plugins/vite', 'config');
  addValue('$public-key', publicKey.replaceAll('\r\n', '\n').trim(), 'metadata');
  return { ...createInputManifest(inputs.values()), graph: diagnostics };
}

export async function computeMainHash() {
  const desktopRoot = path.join(defaultRoot, 'apps/desktop');
  const previous = process.env[collectEnv];
  const previousPlatform = process.env.npm_config_platform;
  process.env[collectEnv] = '1';
  // Vite config messages must not contaminate the CLI hash on stdout.
  const originalInfo = console.info;
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);
  console.info = (...args) => console.error(...args);
  let manifest;
  try {
    const graph = [];
    // All hosts inspect the same platform implementations, including unselected branches.
    for (const platform of ['darwin', 'linux', 'win32']) {
      process.env.npm_config_platform = platform;
      for (const target of ['main', 'preload']) {
        graph.push({
          ...(await collectViteGraph({
            configFile: path.join(desktopRoot, `vite.${target}.config.ts`),
            mode: 'production',
          })),
          label: `${target}/${platform}`,
        });
      }
    }
    manifest = await collectSourceInputs({
      cloudRoot: process.env.CLOUD_DESKTOP === '1' ? path.dirname(defaultRoot) : undefined,
      graph,
    });
  } finally {
    if (previousPlatform === undefined) delete process.env.npm_config_platform;
    else process.env.npm_config_platform = previousPlatform;
    console.info = originalInfo;
    console.log = originalLog;
    if (previous === undefined) delete process.env[collectEnv];
    else process.env[collectEnv] = previous;
  }
  const releaseDir = path.join(desktopRoot, 'release');
  await mkdir(releaseDir, { recursive: true });
  await writeFile(
    path.join(releaseDir, 'renderer-mainhash-inputs.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest.mainHash;
}

export async function resolveMainHash(mode) {
  if (process.env[collectEnv] === '1') return MAIN_HASH_PLACEHOLDER;
  if (!process.env.MAIN_HASH) return mode === 'development' ? '' : computeMainHash();
  if (!/^[0-9a-f]{64}$/.test(process.env.MAIN_HASH)) {
    throw new Error('MAIN_HASH must be a 64-character lowercase SHA-256');
  }
  return process.env.MAIN_HASH;
}

export const rendererMainHashArtifact = (mainHash) => ({
  name: 'renderer-main-hash-artifact',
  async writeBundle() {
    const releaseDir = path.join(defaultRoot, 'apps/desktop/release');
    await mkdir(releaseDir, { recursive: true });
    await writeFile(path.join(releaseDir, 'renderer-mainhash.txt'), `${mainHash}\n`);
  },
});

if (
  process.env[collectEnv] !== '1' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === scriptPath
) {
  computeMainHash().then(
    (hash) => console.log(hash),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
