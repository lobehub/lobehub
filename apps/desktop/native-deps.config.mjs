/* eslint-disable no-console */
/**
 * Native dependencies configuration for Electron build
 *
 * Native modules (containing .node bindings) require special handling:
 * 1. Must be externalized in Vite/Rollup to prevent bundling
 * 2. Must be included in electron-builder files
 * 3. Must be unpacked from asar archive
 *
 * This module automatically resolves the full dependency tree.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get the current target platform
 * During build, electron-builder sets npm_config_platform
 * Falls back to os.platform() for development
 */
function getTargetPlatform() {
  return process.env.npm_config_platform || os.platform();
}
const isDarwin = getTargetPlatform() === 'darwin';

/**
 * List of native modules that need special handling
 * Only add the top-level native modules here - dependencies are resolved automatically
 *
 * Platform-specific modules are only included when building for their target platform
 */
export const nativeModules = [
  // macOS-only native modules
  ...(isDarwin ? ['node-mac-permissions'] : []),
  '@napi-rs/canvas',
  'get-windows',
  'node-screenshots',
];

const optionalNativePackagePrefixes = new Map([
  ['@napi-rs/canvas', ['@napi-rs/canvas-']],
  ['node-screenshots', ['node-screenshots-']],
]);

const runtimeOptionalDependencies = new Map([['get-windows', ['@mapbox/node-pre-gyp']]]);

const runtimeDependencyOverrides = new Map([
  // get-windows imports @mapbox/node-pre-gyp at runtime only for find().
  // Keep the narrow find() dependency path and avoid shipping its install,
  // publish, and CLI dependency tree into app.asar.
  ['@mapbox/node-pre-gyp', ['detect-libc', 'nopt', 'npmlog', 'semver']],
]);

function getRuntimeDependencies(moduleName, dependencies) {
  return runtimeDependencyOverrides.get(moduleName) || Object.keys(dependencies);
}

function getRuntimeOptionalDependencies(moduleName, optionalDependencies) {
  const prefixes = optionalNativePackagePrefixes.get(moduleName);
  const dependencies = [...(runtimeOptionalDependencies.get(moduleName) || [])];

  if (prefixes) {
    dependencies.push(
      ...Object.keys(optionalDependencies).filter((dep) =>
        prefixes.some((prefix) => dep.startsWith(prefix)),
      ),
    );
  }

  return dependencies;
}

/**
 * Recursively resolve all dependencies of a module
 * @param {string} moduleName - The module to resolve
 * @param {Set<string>} visited - Set of already visited modules (to avoid cycles)
 * @param {string} nodeModulesPath - Path to node_modules directory
 * @returns {Set<string>} Set of all dependencies
 */
function resolveDependencies(
  moduleName,
  visited = new Set(),
  nodeModulesPath = path.join(__dirname, 'node_modules'),
) {
  if (visited.has(moduleName)) {
    return visited;
  }

  // Always add the module name first (important for workspace dependencies
  // that may not be in local node_modules but are declared in nativeModules)
  visited.add(moduleName);

  const packageJsonPath = path.join(nodeModulesPath, moduleName, 'package.json');

  // If module doesn't exist locally, still keep it in visited but skip dependency resolution
  if (!fs.existsSync(packageJsonPath)) {
    return visited;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = packageJson.dependencies || {};
    const optionalDependencies = packageJson.optionalDependencies || {};

    // Resolve regular dependencies
    for (const dep of getRuntimeDependencies(moduleName, dependencies)) {
      resolveDependencies(dep, visited, nodeModulesPath);
    }

    // Only include optional packages that are runtime native binaries for the
    // module itself. Native packages can also list install-time toolchains such
    // as node-gyp or node-pre-gyp as optional deps; those must not be copied or
    // externalized into the packaged Electron app.
    for (const dep of getRuntimeOptionalDependencies(moduleName, optionalDependencies)) {
      resolveDependencies(dep, visited, nodeModulesPath);
    }
  } catch {
    // Ignore errors reading package.json
  }

  return visited;
}

/**
 * Get all dependencies for all native modules (including transitive dependencies)
 * @returns {string[]} Array of all dependency names
 */
export function getAllDependencies() {
  const allDeps = new Set();

  for (const nativeModule of nativeModules) {
    const deps = resolveDependencies(nativeModule);
    for (const dep of deps) {
      allDeps.add(dep);
    }
  }

  return [...allDeps];
}

/**
 * Generate glob patterns for electron-builder files config
 * @returns {string[]} Array of glob patterns
 */
export function getFilesPatterns() {
  return getAllDependencies().map((dep) => `node_modules/${dep}/**/*`);
}

/**
 * Generate files config objects for electron-builder to explicitly copy native modules.
 * This uses object form to ensure scoped packages with pnpm symlinks are properly copied.
 * @returns {Array<{from: string, to: string, filter: string[]}>}
 */
export function getNativeModulesFilesConfig() {
  return getAllDependencies().map((dep) => ({
    filter: ['**/*'],
    from: `node_modules/${dep}`,
    to: `node_modules/${dep}`,
  }));
}

/**
 * Generate glob patterns for electron-builder asarUnpack config
 * @returns {string[]} Array of glob patterns
 */
export function getAsarUnpackPatterns() {
  return getAllDependencies().map((dep) => `node_modules/${dep}/**/*`);
}

/**
 * Get the list of native dependencies for Vite external config
 * @returns {string[]} Array of dependency names
 */
export function getExternalDependencies() {
  return getAllDependencies();
}

/**
 * Copy native modules to source node_modules, resolving pnpm symlinks.
 * This is used in beforePack hook to ensure native modules are properly
 * included in the asar archive (electron-builder glob doesn't follow symlinks).
 */
export async function copyNativeModulesToSource() {
  const fsPromises = await import('node:fs/promises');
  const deps = getAllDependencies();
  const sourceNodeModules = path.join(__dirname, 'node_modules');

  console.log(`📦 Resolving ${deps.length} native module symlinks for packaging...`);

  for (const dep of deps) {
    const modulePath = path.join(sourceNodeModules, dep);

    try {
      const stat = await fsPromises.lstat(modulePath);

      if (stat.isSymbolicLink()) {
        // Resolve the symlink to get the real path
        const realPath = await fsPromises.realpath(modulePath);
        console.log(`  📎 ${dep} (resolving symlink)`);

        // Remove the symlink
        await fsPromises.rm(modulePath, { force: true, recursive: true });

        // Create parent directory if needed (for scoped packages like @napi-rs)
        await fsPromises.mkdir(path.dirname(modulePath), { recursive: true });

        // Copy the actual directory content in place of the symlink
        await copyDir(realPath, modulePath);
      }
    } catch (err) {
      // Module might not exist (optional dependency for different platform)
      console.log(`  ⏭️  ${dep} (skipped: ${err.code || err.message})`);
    }
  }

  console.log(`✅ Native module symlinks resolved`);
}

/**
 * Copy native modules to destination, resolving symlinks
 * This is used in afterPack hook to handle pnpm symlinks correctly
 * @param {string} destNodeModules - Destination node_modules path
 */
export async function copyNativeModules(destNodeModules) {
  const fsPromises = await import('node:fs/promises');
  const deps = getAllDependencies();
  const sourceNodeModules = path.join(__dirname, 'node_modules');

  console.log(`📦 Copying ${deps.length} native modules to unpacked directory...`);

  for (const dep of deps) {
    const sourcePath = path.join(sourceNodeModules, dep);
    const destPath = path.join(destNodeModules, dep);

    try {
      // Check if source exists (might be a symlink)
      const stat = await fsPromises.lstat(sourcePath);

      if (stat.isSymbolicLink()) {
        // Resolve the symlink to get the real path
        const realPath = await fsPromises.realpath(sourcePath);
        console.log(`  📎 ${dep} (symlink -> ${path.relative(sourceNodeModules, realPath)})`);

        // Create destination directory
        await fsPromises.mkdir(path.dirname(destPath), { recursive: true });

        // Copy the actual directory content (not the symlink)
        await copyDir(realPath, destPath);
      } else if (stat.isDirectory()) {
        console.log(`  📁 ${dep}`);
        await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
        await copyDir(sourcePath, destPath);
      }
    } catch (err) {
      // Module might not exist (optional dependency for different platform)
      console.log(`  ⏭️  ${dep} (skipped: ${err.code || err.message})`);
    }
  }

  console.log(`✅ Native modules copied successfully`);
}

/**
 * Recursively copy a directory
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDir(src, dest) {
  const fsPromises = await import('node:fs/promises');

  await fsPromises.mkdir(dest, { recursive: true });
  const entries = await fsPromises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      // For symlinks within the module, resolve and copy the actual file
      const realPath = await fsPromises.realpath(srcPath);
      const realStat = await fsPromises.stat(realPath);
      if (realStat.isDirectory()) {
        await copyDir(realPath, destPath);
      } else {
        await fsPromises.copyFile(realPath, destPath);
      }
    } else {
      await fsPromises.copyFile(srcPath, destPath);
    }
  }
}
