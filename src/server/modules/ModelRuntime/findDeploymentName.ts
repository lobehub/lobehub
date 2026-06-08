import type { AiModelConfig } from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';
import { type LobeChatDatabase } from '@/database/type';

/**
 * Server-side equivalent of the frontend `findDeploymentName` helper
 * in `src/services/chat/helper.ts`.
 *
 * For providers that use a separate deployment name (Azure OpenAI,
 * Volcengine, Qwen/Bailian, …) the value the user actually wants to be
 * sent to the provider is stored on the AI model row as
 * `config.deploymentName`. The client-side chat flow resolves this via
 * the AI-infra store, but async/server-side flows (image generation,
 * video generation, webhooks) do not have access to that store and
 * must read the configuration from the database directly.
 *
 * This helper returns the deployment name when one is configured on
 * the (`model`, `provider`) pair for the current user, and otherwise
 * returns the original model id unchanged so callers can safely use it
 * as a drop-in substitute for the raw model id.
 *
 * Related issue: https://github.com/lobehub/lobehub/issues/14450
 */
export const findDeploymentName = async (
  db: LobeChatDatabase,
  userId: string,
  model: string,
  provider: string,
): Promise<string> => {
  try {
    const aiModelModel = new AiModelModel(db, userId);

    // The primary key is (id, providerId, userId), so narrow the lookup
    // by provider to avoid collisions when the same model id is enabled
    // for multiple providers.
    const rows = await aiModelModel.getModelListByProviderId(provider);
    const modelRow = rows.find((item) => item.id === model);

    const config = modelRow?.config as AiModelConfig | undefined;
    const deploymentName = config?.deploymentName;

    return deploymentName && deploymentName.length > 0 ? deploymentName : model;
  } catch {
    // Be conservative: if the DB lookup fails for any reason we must
    // not break image generation for every provider. Fall back to the
    // original model id, which is the previous behaviour.
    return model;
  }
};
