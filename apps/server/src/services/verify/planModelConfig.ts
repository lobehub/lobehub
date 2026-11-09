import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { VerifyModelConfig } from './modelConfig';
import { resolveVerifyServiceModel, VERIFY_PLAN_MODEL_CONFIG } from './modelConfig';

/**
 * The model a verify plan generation runs on: the pinned plan model, unless
 * this deployment cannot run it, then the `verify` service model.
 *
 * The pin exists so a slow reasoning model never silently empties the split
 * (see VERIFY_PLAN_MODEL_CONFIG). But a self-hosted deployment without the
 * pinned provider's key then had no way to generate criteria at all — "Generate
 * criteria" failed with an invalid-key error and run-start splits collapsed to
 * one holistic row — even when the user picked a `verify` service model. A
 * runnable pin always wins; the service model is only the floor under it.
 *
 * Availability is checked the same way as goal review: construct the runtime
 * with the user's vaults and deployment credentials (no paid probe call).
 */
export const resolveVerifyPlanModelConfig = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<VerifyModelConfig> => {
  const canInitialize = async (provider: string) => {
    try {
      await initModelRuntimeFromDB(db, userId, provider, workspaceId);
      return true;
    } catch {
      return false;
    }
  };

  if (await canInitialize(VERIFY_PLAN_MODEL_CONFIG.provider)) return VERIFY_PLAN_MODEL_CONFIG;

  const serviceModel = await resolveVerifyServiceModel(db, userId);
  if (serviceModel && (await canInitialize(serviceModel.provider))) return serviceModel;

  // Nothing runnable: keep the pin so the caller surfaces its credential error.
  return VERIFY_PLAN_MODEL_CONFIG;
};
