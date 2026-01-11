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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * List of native modules that need special handling
 * Only add the top-level native modules here - dependencies are resolved automatically
 */
export const nativeModules = [
  'node-mac-permissions',
  // Add more native modules here as needed
  // e.g., 'better-sqlite3', 'sharp', etc.
];

/**
 * Recursively resolve all dependencies of a module
 * @param {string} moduleName - The module to resolve
 * @param {Set<string>} visited - Set of already visited modules (to avoid cycles)
 * @param {string} nodeModulesPath - Path to node_modules directory
 * @returns {Set<string>} Set of all dependencies
 */
function resolveDependencies(moduleName, visited = new Set(), nodeModulesPath = path.join(__dirname, 'node_modules')) {
  if (visited.has(moduleName)) {
    return visited;
  }

  const packageJsonPath = path.join(nodeModulesPath, moduleName, 'package.json');

  // Check if module exists
  if (!fs.existsSync(packageJsonPath)) {
    return visited;
  }

  visited.add(moduleName);

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = packageJson.dependencies || {};

    for (const dep of Object.keys(dependencies)) {
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
