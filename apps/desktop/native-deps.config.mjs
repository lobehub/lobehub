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
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  copyModulesToSource,
  getDependenciesForModules,
  getModuleFilesConfig,
} from './module-deps.config.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));

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
 * First-party native addon packages are discovered instead of being listed by
 * hand: any `@lobechat/*` workspace package carrying a `binding.gyp` is one.
 * Per-platform gating comes from the package's own
 * `lobechat.nativeAddonPlatforms` field (absent = every platform), and its
 * `build:native` script is what the packaging pipeline invokes — so renaming
 * or adding an addon package never requires touching this file.
 */
export function discoverFirstPartyNativeAddons() {
  const scopeDir = path.join(configDir, 'node_modules', '@lobechat');
  let entries;
  try {
    entries = fs.readdirSync(scopeDir);
  } catch {
    return [];
  }

  const targetPlatform = getTargetPlatform();
  const addons = [];
  for (const entry of entries) {
    // pnpm renames displaced real directories (e.g. earlier copyModulesToSource
    // output) to `.ignored_*` on reinstall — they shadow the live symlink.
    if (entry.startsWith('.')) continue;
    const packageDir = path.join(scopeDir, entry);
    if (!fs.existsSync(path.join(packageDir, 'binding.gyp'))) continue;

    let packageJson;
    try {
      packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }

    const platforms = packageJson.lobechat?.nativeAddonPlatforms;
    if (Array.isArray(platforms) && !platforms.includes(targetPlatform)) continue;

    addons.push({
      hasBuildScript: Boolean(packageJson.scripts?.['build:native']),
      name: packageJson.name,
    });
  }
  return addons;
}

const firstPartyNativeAddons = discoverFirstPartyNativeAddons();

export function buildFirstPartyNativeAddons() {
  for (const addon of firstPartyNativeAddons) {
    if (!addon.hasBuildScript) continue;
    console.info(`🔧 Building native addon ${addon.name}...`);
    execSync(`pnpm --filter ${addon.name} build:native`, { cwd: configDir, stdio: 'inherit' });
  }
}

/**
 * List of native modules that need special handling
 * Only add the top-level native modules here - dependencies are resolved automatically
 *
 * Platform-specific modules are only included when building for their target platform
 */
export const nativeModules = [
  ...firstPartyNativeAddons.map((addon) => addon.name),
  // macOS-only native modules
  ...(isDarwin ? ['node-mac-permissions'] : []),
  '@lydell/node-pty',
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
    ...firstPartyNativeAddons.map((addon) => `node_modules/${addon.name}/build/Release/*.node`),
    'node_modules/@lydell/node-pty-*/prebuilds/**/*.node',
    'node_modules/@lydell/node-pty-*/prebuilds/*/spawn-helper',
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
