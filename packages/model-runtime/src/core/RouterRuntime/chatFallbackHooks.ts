import debug from 'debug';

import type { RouteAttemptFinished } from './routeAttempt';
import type { CreateRouterRuntimeOptions } from './routerOptions';

const log = debug('lobe-model-runtime:router-runtime');

/**
 * Image-output models hold their reasoning until the final image so a failure before it can
 * still fall back. An unknown capability keeps the regular commit rule rather than failing.
 */
export const resolveHoldReasoning = async (
  isImageOutputModel: CreateRouterRuntimeOptions['isImageOutputModel'],
  model: string,
): Promise<boolean> => {
  try {
    return Boolean(await isImageOutputModel?.(model));
  } catch (error) {
    console.error('[RouterRuntime] isImageOutputModel callback failed:', error);
    return false;
  }
};

/** A failing policy callback must not restart a provider call, so it resolves to no fallback. */
export const createChatAttemptFallbackCheck =
  (shouldFallbackChatAttempt: CreateRouterRuntimeOptions['shouldFallbackChatAttempt']) =>
  async (result: RouteAttemptFinished): Promise<boolean> => {
    try {
      return Boolean(await shouldFallbackChatAttempt?.(result));
    } catch (error) {
      log('shouldFallbackChatAttempt callback error: %O', error);
      return false;
    }
  };
