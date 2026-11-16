/**
 * Builtin Tool Executor Registry
 *
 * Lightweight registry shell for builtin tool executors. Executor
 * implementations live behind one asynchronous catalog boundary so importing
 * the store does not pull every tool runtime into the initial SPA graph.
 */

import { DashboardIdentifier, LegacyDashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { GoalIdentifier, LegacyGoalIdentifier } from '@lobechat/builtin-tool-goal';

import type { BuiltinToolContext, BuiltinToolResult, IBuiltinToolExecutor } from '../types';
import { stashBuiltinToolWorkIntent } from './workRegistration';

/**
 * Registry structure: Map<identifier, executor instance>
 */
const executorRegistry = new Map<string, IBuiltinToolExecutor>();
let executorsRegistered = false;
let registrationPromise: Promise<void> | undefined;

/**
 * Get a builtin tool executor by identifier
 *
 * @param identifier - The tool identifier
 * @returns The executor instance or undefined if not found
 */
export const getExecutor = (identifier: string): IBuiltinToolExecutor | undefined => {
  return executorRegistry.get(identifier);
};

/**
 * Check if an executor exists for the given identifier and apiName
 *
 * @param identifier - The tool identifier
 * @param apiName - The API name
 * @returns Whether the executor exists and supports the API
 */
export const hasExecutor = async (identifier: string, apiName: string): Promise<boolean> => {
  await registerBuiltinToolExecutors();

  const executor = executorRegistry.get(identifier);
  return executor?.hasApi(apiName) ?? false;
};

/**
 * Get all registered identifiers
 *
 * @returns Array of registered identifiers
 */
export const getRegisteredIdentifiers = (): string[] => {
  return Array.from(executorRegistry.keys());
};

/**
 * Get all API names for a given identifier
 *
 * @param identifier - The tool identifier
 * @returns Array of API names or empty array if identifier not found
 */
export const getApiNamesForIdentifier = (identifier: string): string[] => {
  const executor = executorRegistry.get(identifier);
  return executor?.getApiNames() ?? [];
};

/**
 * Invoke a builtin tool executor
 *
 * @param identifier - The tool identifier
 * @param apiName - The API name
 * @param params - The parameters
 * @param ctx - The execution context
 * @returns The execution result
 */
export const invokeExecutor = async (
  identifier: string,
  apiName: string,
  params: any,
  ctx: BuiltinToolContext,
): Promise<BuiltinToolResult> => {
  await registerBuiltinToolExecutors();

  const executor = executorRegistry.get(identifier);

  if (!executor) {
    return {
      error: {
        message: `Executor not found: ${identifier}`,
        type: 'ExecutorNotFound',
      },
      success: false,
    };
  }

  if (!executor.hasApi(apiName)) {
    return {
      error: {
        message: `API not found: ${identifier}/${apiName}`,
        type: 'ApiNotFound',
      },
      success: false,
    };
  }

  const result = await executor.invoke(apiName, params, ctx);

  // Manifest-driven Work registration (best-effort; a no-op unless the API
  // declares a `work` config). Only STASH the intent here — `call_tool` drains
  // it and writes the Work version once the tool call's cumulative cost is known
  // (write-once instead of register-then-backfill).
  stashBuiltinToolWorkIntent(identifier, apiName, params, ctx, result);

  return result;
};

/**
 * Register builtin tool executor instances
 *
 * @param executors - Array of executor instances to register
 */
const registerExecutors = (executors: IBuiltinToolExecutor[]): void => {
  for (const executor of executors) {
    executorRegistry.set(executor.identifier, executor);
  }

  // Goal calls approved after the rename still name the tool `lobe-goal`.
  const goalExecutor = executorRegistry.get(GoalIdentifier);
  if (goalExecutor) executorRegistry.set(LegacyGoalIdentifier, goalExecutor);
  // Same for dashboard calls approved after the rename from `lobe-dashboard`.
  const dashboardExecutor = executorRegistry.get(DashboardIdentifier);
  if (dashboardExecutor) executorRegistry.set(LegacyDashboardIdentifier, dashboardExecutor);
};

/**
 * A failed catalog import usually cannot be retried in place: Chromium (and so
 * Electron 44) caches a module that failed to fetch, link or evaluate for the
 * document's lifetime, so every later `import('./catalog')` rejects instantly
 * with the same error until the window reloads. Name the remedy so the agent
 * and the user see an action instead of a bare module URL.
 */
const toCatalogLoadError = (error: unknown): Error => {
  const reason = error instanceof Error ? error.message : String(error);

  return new Error(
    `Builtin tools failed to load (${reason}). The window keeps this failure until it reloads: reload the app window or page, then retry the tool call.`,
    { cause: error },
  );
};

export const registerBuiltinToolExecutors = async (): Promise<void> => {
  if (executorsRegistered) return;

  registrationPromise ??= import('./catalog').then(({ builtinToolExecutors }) => {
    registerExecutors(builtinToolExecutors);
    executorsRegistered = true;
  });

  try {
    await registrationPromise;
  } catch (error) {
    // Still allow a later call to retry: browsers that re-fetch failed modules
    // (Chromium 156+) recover without a reload.
    registrationPromise = undefined;
    throw toCatalogLoadError(error);
  }
};
