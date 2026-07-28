import type { AiProviderModelListItem, AiProviderRuntimeState } from 'model-bank';

import { getHiddenBuiltinModelsForUser } from '@/business/server/aiProvider';
import {
  filterEnabledProvidersByModelType,
  filterHiddenBuiltinModels,
  filterHiddenProviderModels,
} from '@/utils/aiProvider';

interface AiProviderModelListOptions {
  enabled?: boolean;
  limit?: number;
  offset?: number;
  type?: string;
}

interface UserScopedRuntimeStateOptions {
  throwOnUnresolvedAccess?: boolean;
}

/**
 * Resolves a user-scoped model list after the repository has loaded its complete cached data.
 * For providers with hidden models, pagination is applied after filtering so hidden rows neither
 * leak nor consume visible result slots.
 */
export const getUserScopedAiProviderModelList = async (
  userId: string,
  providerId: string,
  options: AiProviderModelListOptions,
  loadModelList: (options: AiProviderModelListOptions) => Promise<AiProviderModelListItem[]>,
): Promise<AiProviderModelListItem[]> => {
  const hiddenBuiltinModels = await getHiddenBuiltinModelsForUser(userId);
  if (hiddenBuiltinModels === undefined) return [];

  const hasHiddenModels = hiddenBuiltinModels.some((model) => model.providerId === providerId);

  if (!hasHiddenModels) return loadModelList(options);

  const models = await loadModelList({
    ...options,
    limit: undefined,
    offset: undefined,
  });
  const visibleModels = filterHiddenProviderModels(models, providerId, hiddenBuiltinModels);
  const offset = Math.max(0, options.offset ?? 0);

  if (typeof options.limit === 'number') {
    return visibleModels.slice(offset, offset + Math.max(0, options.limit));
  }

  return offset > 0 ? visibleModels.slice(offset) : visibleModels;
};

/**
 * Resolves a user-scoped runtime state for server consumers that select or expose builtin models.
 * The repository state stays complete and cacheable; access filtering is applied to the returned copy.
 */
export const getUserScopedAiProviderRuntimeState = async (
  userId: string,
  loadRuntimeState: () => Promise<AiProviderRuntimeState>,
  options: UserScopedRuntimeStateOptions = {},
): Promise<AiProviderRuntimeState> => {
  const [runtimeState, hiddenBuiltinModels] = await Promise.all([
    loadRuntimeState(),
    getHiddenBuiltinModelsForUser(userId),
  ]);
  const isHiddenBuiltinModelsResolved = hiddenBuiltinModels !== undefined;
  if (!isHiddenBuiltinModelsResolved && options.throwOnUnresolvedAccess) {
    throw new Error('Unable to resolve user-scoped model access');
  }

  const enabledAiModels = isHiddenBuiltinModelsResolved
    ? filterHiddenBuiltinModels(runtimeState.enabledAiModels, hiddenBuiltinModels)
    : [];

  return {
    ...runtimeState,
    enabledAiModels,
    enabledChatAiProviders: filterEnabledProvidersByModelType(
      runtimeState.enabledChatAiProviders,
      enabledAiModels,
      'chat',
    ),
    enabledImageAiProviders: filterEnabledProvidersByModelType(
      runtimeState.enabledImageAiProviders,
      enabledAiModels,
      'image',
    ),
    enabledVideoAiProviders: filterEnabledProvidersByModelType(
      runtimeState.enabledVideoAiProviders,
      enabledAiModels,
      'video',
    ),
    ...(isHiddenBuiltinModelsResolved
      ? { hiddenBuiltinModels }
      : { hiddenBuiltinModelsResolved: false }),
    runtimeConfig: isHiddenBuiltinModelsResolved ? runtimeState.runtimeConfig : {},
  };
};
