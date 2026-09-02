import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILTINS = new Set(builtinModules);
const SPECIFIER_RE =
  /^\s*import\b[^;'"]*["']([^"'\s./][^"'\s]*)["']|\b(?:import|__require|require)\(\s*["']([^"'\s./][^"'\s]*)["']\s*\)/gm;

export const packageNameOf = (specifier: string): string | undefined => {
  if (specifier.startsWith('node:')) return;
  const segments = specifier.split('/');
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  if (!name || BUILTINS.has(name)) return;
  return name;
};

export const collectExternals = (sources: string[]): string[] => {
  const names = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(SPECIFIER_RE)) {
      const name = packageNameOf(match[1] ?? match[2]);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
};

export const resolveInstalledVersion = (name: string, fromDir: string): string | undefined => {
  let dir = fromDir;
  for (;;) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) {
      const installed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name: string;
        version: string;
      };
      return installed.name === name
        ? installed.version
        : `npm:${installed.name}@${installed.version}`;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
};

export const patchedDependenciesFor = (names: Set<string>, patchesDir: string) => {
  const patched: Record<string, string> = {};
  if (!existsSync(patchesDir)) return patched;
  for (const file of readdirSync(patchesDir)) {
    if (!file.endsWith('.patch')) continue;
    const name = file.slice(0, -'.patch'.length).replace('__', '/');
    if (names.has(name)) patched[name] = `patches/${file}`;
  }
  return patched;
};

export const onlyBuiltDependenciesFor = (names: Set<string>, workspaceFile: string) => {
  if (!existsSync(workspaceFile)) return [];
  const lines = readFileSync(workspaceFile, 'utf8').split('\n');
  const start = lines.indexOf('onlyBuiltDependencies:');
  if (start === -1) return [];
  const listed: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s+-\s*['"]?([^\s'"]+)/);
    if (!match) break;
    listed.push(match[1]);
  }
  return listed.filter((name) => names.has(name));
};

export const packageManagerOf = (workspaceFile: string): string | undefined => {
  const rootManifest = path.join(path.dirname(workspaceFile), 'package.json');
  if (!existsSync(rootManifest)) return;
  return JSON.parse(readFileSync(rootManifest, 'utf8')).packageManager as string | undefined;
};

export interface RuntimeManifest {
  dependencies: Record<string, string>;
  missing: string[];
  onlyBuiltDependencies: string[];
  packageManager?: string;
  patchedDependencies: Record<string, string>;
}

export const buildRuntimeManifest = (
  distDir: string,
  patchesDir: string,
  workspaceFile: string,
): RuntimeManifest => {
  const sources = readdirSync(distDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));

  const dependencies: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of collectExternals(sources)) {
    const version = resolveInstalledVersion(name, distDir);
    if (version) dependencies[name] = version;
    else missing.push(name);
  }

  const names = new Set(Object.keys(dependencies));
  return {
    dependencies,
    missing,
    onlyBuiltDependencies: onlyBuiltDependenciesFor(names, workspaceFile),
    packageManager: packageManagerOf(workspaceFile),
    patchedDependencies: patchedDependenciesFor(names, patchesDir),
  };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);
  const option = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const distDir = path.resolve(option('--dist') ?? 'apps/server/dist');
  const outDir = path.resolve(option('--out') ?? 'apps/server/runtime');
  const patchesDir = path.resolve(option('--patches') ?? 'patches');
  const workspaceFile = path.resolve(option('--workspace') ?? 'pnpm-workspace.yaml');

  const { dependencies, missing, onlyBuiltDependencies, packageManager, patchedDependencies } =
    buildRuntimeManifest(distDir, patchesDir, workspaceFile);
  writeFileSync(
    path.join(outDir, 'package.json'),
    JSON.stringify(
      { name: 'lobe-hono-runtime', private: true, type: 'module', packageManager, dependencies },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    path.join(outDir, 'pnpm-workspace.yaml'),
    [
      'onlyBuiltDependencies:',
      ...onlyBuiltDependencies.map((name) => `  - '${name}'`),
      'patchedDependencies:',
      ...Object.entries(patchedDependencies).map(([name, file]) => `  '${name}': ${file}`),
      '',
    ].join('\n'),
  );

  const count = Object.keys(dependencies).length;
  console.log(`hono runtime deps: ${count} packages → ${path.join(outDir, 'package.json')}`);
  if (missing.length > 0) console.warn(`not installed, skipped: ${missing.join(', ')}`);
}
