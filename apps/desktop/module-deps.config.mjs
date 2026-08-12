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
 * @param {{skipOptionalDependenciesFor?: Set<string>}} options - Dependency traversal options
 * @returns {Set<string>} Set of all dependencies
 */
function resolveDependencies(
  moduleName,
  visited = new Set(),
  nodeModulesPath = sourceNodeModules,
  options = {},
) {
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
      resolveDependencies(dep, visited, nodeModulesPath, options);
    }

    if (!options.skipOptionalDependenciesFor?.has(moduleName)) {
      for (const dep of Object.keys(optionalDependencies)) {
        resolveDependencies(dep, visited, nodeModulesPath, options);
      }
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
 * @param {{skipOptionalDependenciesFor?: Set<string>}} options
 * @returns {string[]}
 */
export function getDependenciesForModules(modules, options = {}) {
  const allDeps = new Set();

  for (const moduleName of modules) {
    const deps = resolveDependencies(moduleName, new Set(), sourceNodeModules, options);
    for (const dep of deps) {
      allDeps.add(dep);
    }
  }

  return [...allDeps];
}

/**
 * Generate object-form electron-builder files config.
 * Object form is required because pnpm symlinks are resolved before packaging.
 * @param {string[]} modules
 * @param {{skipOptionalDependenciesFor?: Set<string>}} options
 * @returns {Array<{from: string, to: string, filter: string[]}>}
 */
export function getModuleFilesConfig(modules, options = {}) {
  return getDependenciesForModules(modules, options).map((dep) => ({
    filter: ['**/*', '!**/*.map'],
    from: `node_modules/${dep}`,
    to: `node_modules/${dep}`,
  }));
}

/**
 * Copy module symlinks in source node_modules to real directories so
 * electron-builder can include them via file rules.
 * @param {string[]} modules
 * @param {string} label
 * @param {{skipOptionalDependenciesFor?: Set<string>}} options
 */
export async function copyModulesToSource(modules, label, options = {}) {
  const deps = getDependenciesForModules(modules, options);

  console.info(`📦 Resolving ${deps.length} ${label} symlinks for packaging...`);

  for (const dep of deps) {
    const modulePath = path.join(sourceNodeModules, dep);

    try {
      const stat = await fs.promises.lstat(modulePath);

      if (stat.isSymbolicLink()) {
        const realPath = await fs.promises.realpath(modulePath);
        console.info(`  📎 ${dep} (resolving symlink)`);

        await fs.promises.rm(modulePath, { force: true, recursive: true });
        await fs.promises.mkdir(path.dirname(modulePath), { recursive: true });
        await copyDir(realPath, modulePath);
      }
    } catch (err) {
      console.info(`  ⏭️  ${dep} (skipped: ${err.code || err.message})`);
    }
  }

  console.info(`✅ ${label} symlinks resolved`);
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
