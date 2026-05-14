import {
  copyModulesToSource,
  getDependenciesForModules,
  getModuleFilesConfig,
} from './module-deps.config.mjs';

/**
 * Non-native modules intentionally externalized from the main-process bundle.
 *
 * These modules are not native dependencies. They stay external because their
 * process-level side effects must be owned by one Node runtime module instance.
 */
export const externalRuntimeModules = ['electron-log'];

/**
 * Get all dependencies for runtime external modules.
 * @returns {string[]}
 */
export function getAllExternalRuntimeDependencies() {
  return getDependenciesForModules(externalRuntimeModules);
}

/**
 * Generate files config objects for non-native runtime external modules.
 * @returns {Array<{from: string, to: string, filter: string[]}>}
 */
export function getExternalRuntimeModulesFilesConfig() {
  return getModuleFilesConfig(externalRuntimeModules);
}

export async function copyExternalRuntimeModulesToSource() {
  await copyModulesToSource(externalRuntimeModules, 'runtime external module');
}
