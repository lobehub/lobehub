/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceNodeModules = path.join(__dirname, 'node_modules');

/**
 * Recursively resolve all dependencies of a module.
 * @param {string} moduleName - The module to resolve
 * @param {Set<string>} visited - Set of already visited modules
 * @param {string} nodeModulesPath - Path to node_modules directory
 * @returns {Set<string>} Set of all dependencies
 */
function resolveDependencies(moduleName, visited = new Set(), nodeModulesPath = sourceNodeModules) {
  if (visited.has(moduleName)) {
    return visited;
  }

  // Always add the module name first. Workspace and optional platform modules
  // may not be materialized locally, but they still need stable package rules.
  visited.add(moduleName);

  const packageJsonPath = path.join(nodeModulesPath, moduleName, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return visited;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = packageJson.dependencies || {};
    const optionalDependencies = packageJson.optionalDependencies || {};

    for (const dep of Object.keys(dependencies)) {
      resolveDependencies(dep, visited, nodeModulesPath);
    }

    for (const dep of Object.keys(optionalDependencies)) {
      resolveDependencies(dep, visited, nodeModulesPath);
    }
  } catch {
    // Ignore unreadable package.json files; electron-builder will surface any
    // actual missing runtime dependency during packaging or startup.
  }

  return visited;
}

/**
 * Get all transitive dependencies for a set of top-level modules.
 * @param {string[]} modules
 * @returns {string[]}
 */
export function getDependenciesForModules(modules) {
  const allDeps = new Set();

  for (const moduleName of modules) {
    const deps = resolveDependencies(moduleName);
    for (const dep of deps) {
      allDeps.add(dep);
    }
  }

  return [...allDeps];
}

/**
 * Generate glob patterns for electron-builder files config.
 * @param {string[]} modules
 * @returns {string[]}
 */
export function getModuleFilesPatterns(modules) {
  return getDependenciesForModules(modules).map((dep) => `node_modules/${dep}/**/*`);
}

/**
 * Generate object-form electron-builder files config.
 * Object form is required because pnpm symlinks are resolved before packaging.
 * @param {string[]} modules
 * @returns {Array<{from: string, to: string, filter: string[]}>}
 */
export function getModuleFilesConfig(modules) {
  return getDependenciesForModules(modules).map((dep) => ({
    filter: ['**/*'],
    from: `node_modules/${dep}`,
    to: `node_modules/${dep}`,
  }));
}

/**
 * Copy module symlinks in source node_modules to real directories so
 * electron-builder can include them via file rules.
 * @param {string[]} modules
 * @param {string} label
 */
export async function copyModulesToSource(modules, label) {
  const deps = getDependenciesForModules(modules);

  console.log(`📦 Resolving ${deps.length} ${label} symlinks for packaging...`);

  for (const dep of deps) {
    const modulePath = path.join(sourceNodeModules, dep);

    try {
      const stat = await fs.promises.lstat(modulePath);

      if (stat.isSymbolicLink()) {
        const realPath = await fs.promises.realpath(modulePath);
        console.log(`  📎 ${dep} (resolving symlink)`);

        await fs.promises.rm(modulePath, { force: true, recursive: true });
        await fs.promises.mkdir(path.dirname(modulePath), { recursive: true });
        await copyDir(realPath, modulePath);
      }
    } catch (err) {
      console.log(`  ⏭️  ${dep} (skipped: ${err.code || err.message})`);
    }
  }

  console.log(`✅ ${label} symlinks resolved`);
}

/**
 * Copy modules to a destination node_modules directory, resolving symlinks.
 * @param {string[]} modules
 * @param {string} destNodeModules
 * @param {string} label
 */
export async function copyModulesToDirectory(modules, destNodeModules, label) {
  const deps = getDependenciesForModules(modules);

  console.log(`📦 Copying ${deps.length} ${label} to unpacked directory...`);

  for (const dep of deps) {
    const sourcePath = path.join(sourceNodeModules, dep);
    const destPath = path.join(destNodeModules, dep);

    try {
      const stat = await fs.promises.lstat(sourcePath);

      if (stat.isSymbolicLink()) {
        const realPath = await fs.promises.realpath(sourcePath);
        console.log(`  📎 ${dep} (symlink -> ${path.relative(sourceNodeModules, realPath)})`);

        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await copyDir(realPath, destPath);
      } else if (stat.isDirectory()) {
        console.log(`  📁 ${dep}`);
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await copyDir(sourcePath, destPath);
      }
    } catch (err) {
      console.log(`  ⏭️  ${dep} (skipped: ${err.code || err.message})`);
    }
  }

  console.log(`✅ ${label} copied successfully`);
}

/**
 * Recursively copy a directory.
 * @param {string} src
 * @param {string} dest
 */
async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const realPath = await fs.promises.realpath(srcPath);
      const realStat = await fs.promises.stat(realPath);
      if (realStat.isDirectory()) {
        await copyDir(realPath, destPath);
      } else {
        await fs.promises.copyFile(realPath, destPath);
      }
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}
