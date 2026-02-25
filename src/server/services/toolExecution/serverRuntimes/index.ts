/**
 * Server Runtime Registry
 *
 * Central registry for all builtin tool server runtimes.
 * Uses factory functions to support both:
 * - Pre-instantiated runtimes (e.g., WebBrowsing - no per-request context needed)
 * - Per-request runtimes (e.g., CloudSandbox - needs topicId, userId)
 */
import { type ToolExecutionContext } from '../types';
import { calculatorRuntime } from './calculator';
import { cloudSandboxRuntime } from './cloudSandbox';
import { memoryRuntime } from './memory';
import { notebookRuntime } from './notebook';
import { skillsRuntime } from './skills';
import { skillStoreRuntime } from './skillStore';
import { toolsActivatorRuntime } from './tools';
import { type ServerRuntimeFactory, type ServerRuntimeRegistration } from './types';
import { webBrowsingRuntime } from './webBrowsing';

/**
 * Registry of server runtime factories by identifier
 */
const serverRuntimeFactories = new Map<string, ServerRuntimeFactory>();

/**
 * Register server runtimes
 */
const registerRuntimes = (runtimes: ServerRuntimeRegistration[]) => {
  for (const runtime of runtimes) {
    serverRuntimeFactories.set(runtime.identifier, runtime.factory);
  }
};

// Register all server runtimes
registerRuntimes([
  webBrowsingRuntime,
  cloudSandboxRuntime,
  calculatorRuntime,
  notebookRuntime,
  skillStoreRuntime,
  skillsRuntime,
  memoryRuntime,
  toolsActivatorRuntime,
]);

// ==================== Registry API ====================

/**
 * Get a server runtime by identifier
 * @param identifier - The tool identifier
 * @param context - Execution context (required for per-request runtimes)
 * @returns Runtime instance (may be a Promise for async factories)
 */
export const getServerRuntime = (
  identifier: string,
  context: ToolExecutionContext,
): any | Promise<any> => {
  const factory = serverRuntimeFactories.get(identifier);
  return factory?.(context);
};

/**
 * Check if a server runtime exists for the given identifier
 */
export const hasServerRuntime = (identifier: string): boolean => {
  return serverRuntimeFactories.has(identifier);
};

/**
 * Get all registered server runtime identifiers
 */
export const getServerRuntimeIdentifiers = (): string[] => {
  return Array.from(serverRuntimeFactories.keys());
};
