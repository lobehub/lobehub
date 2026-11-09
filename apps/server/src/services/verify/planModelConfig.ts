import { AgentRuntimeErrorType } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';

import type { VerifyModelConfig } from './modelConfig';
import { resolveVerifyServiceModel, VERIFY_PLAN_MODEL_CONFIG } from './modelConfig';

const isInvalidProviderApiKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const record = error as { errorType?: unknown; message?: unknown };
  return [record.errorType, record.message].includes(AgentRuntimeErrorType.InvalidProviderAPIKey);
};

/**
 * Run one verify plan generation (requirement → named criteria) on the pinned
 * plan model, falling back to the `verify` service model when the pin has no
 * usable credentials.
 *
 * The pin exists so a slow reasoning model never silently empties the split
 * (see VERIFY_PLAN_MODEL_CONFIG). But a self-hosted deployment without the
 * pinned provider's key then could not generate criteria at all — "Generate
 * criteria" failed with an invalid-key error and run-start splits collapsed to
 * one holistic row — even when the user picked a `verify` service model.
 *
 * Credentials are only known once the call is made: router runtimes (DeepSeek
 * among them) construct lazily, so constructing the runtime proves nothing.
 * Hence one bounded retry, only on an invalid-key error, never on other
 * failures; with no different service model the original error is rethrown.
 */
export const runOnVerifyPlanModel = async <T>(
  db: LobeChatDatabase,
  userId: string,
  run: (config: VerifyModelConfig) => Promise<T>,
): Promise<T> => {
  try {
    return await run(VERIFY_PLAN_MODEL_CONFIG);
  } catch (error) {
    if (!isInvalidProviderApiKeyError(error)) throw error;

    const serviceModel = await resolveVerifyServiceModel(db, userId);
    if (
      !serviceModel ||
      (serviceModel.provider === VERIFY_PLAN_MODEL_CONFIG.provider &&
        serviceModel.model === VERIFY_PLAN_MODEL_CONFIG.model)
    )
      throw error;

    return run(serviceModel);
  }
};
