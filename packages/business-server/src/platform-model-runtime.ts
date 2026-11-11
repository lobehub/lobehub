import type { ModelRuntimeHooks } from '@lobechat/model-runtime';

/**
 * Hooks for a runtime the platform pays for, with no user or Workspace to bill. The business
 * build records each call's cost for the platform; it never gates or charges the call.
 */
export function getPlatformModelRuntimeHooks(): ModelRuntimeHooks | undefined {
  return undefined;
}
