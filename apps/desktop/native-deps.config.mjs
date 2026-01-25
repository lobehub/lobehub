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
  // Add more native modules here as needed
];

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
    for (const dep of Object.keys(dependencies)) {
      resolveDependencies(dep, visited, nodeModulesPath);
    }

    // Also resolve optional dependencies (important for native modules like @napi-rs/canvas
    // which have platform-specific binaries in optional deps)
    for (const dep of Object.keys(optionalDependencies)) {
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
