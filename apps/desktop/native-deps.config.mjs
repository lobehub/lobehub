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
import os from 'node:os';

import {
  copyModulesToSource,
  getDependenciesForModules,
  getModuleFilesConfig,
} from './module-deps.config.mjs';

/**
 * Get the current target platform
 * During build, electron-builder sets npm_config_platform
 * Falls back to os.platform() for development
 */
function getTargetPlatform() {
  return process.env.npm_config_platform || os.platform();
}
const isDarwin = getTargetPlatform() === 'darwin';

// The packaged macOS runtime invokes get-windows' native helper directly.
// Its optional dependencies are build/install tooling and the Windows loader
// chain, neither of which is required in a macOS application artifact.
const dependencyOptions = isDarwin ? { skipOptionalDependenciesFor: new Set(['get-windows']) } : {};

/**
 * List of native modules that need special handling
 * Only add the top-level native modules here - dependencies are resolved automatically
 *
 * Platform-specific modules are only included when building for their target platform
 */
export const nativeModules = [
  // macOS-only native modules
  ...(isDarwin ? ['node-mac-permissions'] : []),
  '@lydell/node-pty',
  '@napi-rs/canvas',
  'get-windows',
  'node-screenshots',
];

/**
 * Get all dependencies for all native modules (including transitive dependencies)
 * @returns {string[]} Array of all dependency names
 */
export function getAllNativeDependencies() {
  return getDependenciesForModules(nativeModules, dependencyOptions);
}

/**
 * Generate files config objects for electron-builder to explicitly copy native modules.
 * This uses object form to ensure scoped packages with pnpm symlinks are properly copied.
 * @returns {Array<{from: string, to: string, filter: string[]}>}
 */
export function getNativeModulesFilesConfig() {
  return getModuleFilesConfig(nativeModules, dependencyOptions);
}

/**
 * Generate glob patterns for electron-builder asarUnpack config
 * @returns {string[]} Array of glob patterns
 */
export function getAsarUnpackPatterns() {
  return [
    'node_modules/@lydell/node-pty-*/prebuilds/**/*.node',
    'node_modules/@lydell/node-pty-*/prebuilds/*/spawn-helper',
    'node_modules/@napi-rs/canvas-*/*.node',
    'node_modules/font-list/libs/darwin/fontlist',
    'node_modules/get-windows/main',
    'node_modules/node-mac-permissions/build/Release/permissions.node',
    'node_modules/node-screenshots-*/*.node',
  ];
}

/**
 * Get the list of native dependencies for Vite external config
 * @returns {string[]} Array of dependency names
 */
export function getNativeExternalDependencies() {
  return getAllNativeDependencies();
}

/**
 * Copy native modules to source node_modules, resolving pnpm symlinks.
 * This is used in beforePack hook to ensure native modules are properly
 * included in the asar archive (electron-builder glob doesn't follow symlinks).
 */
export async function copyNativeModulesToSource() {
  await copyModulesToSource(nativeModules, 'native module', dependencyOptions);
}
