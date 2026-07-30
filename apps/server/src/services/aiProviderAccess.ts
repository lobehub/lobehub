import type {
  AiProviderModelListItem,
  AiProviderRuntimeState,
  BuiltinModelIdentifier,
} from 'model-bank';

import { getHiddenBuiltinModelsForUser, getModelRedirects } from '@/business/server/aiProvider';
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
 * Drops redirect entries whose successor is hidden from the current user, so the client
 * never offers a one-click update to a model the user cannot see or use. Keys are
 * `${providerId}/${modelId}`; the successor lives under the same provider as its key.
 */
const filterHiddenModelRedirects = (
  modelRedirects: Record<string, string>,
  hiddenBuiltinModels: BuiltinModelIdentifier[],
): Record<string, string> => {
  if (hiddenBuiltinModels.length === 0) return modelRedirects;

  return Object.fromEntries(
    Object.entries(modelRedirects).filter(([key, successorId]) => {
      const providerId = key.split('/')[0];
      return !hiddenBuiltinModels.some(
        (hidden) => hidden.providerId === providerId && hidden.id === successorId,
      );
    }),
  );
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
  const [runtimeState, hiddenBuiltinModels, modelRedirects] = await Promise.all([
    loadRuntimeState(),
    getHiddenBuiltinModelsForUser(userId),
    getModelRedirects(),
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
    // Redirects follow the same fail-closed policy as hidden models: an unresolved
    // access policy must not advertise successor ids, and a successor hidden from
    // this user must not be offered as a remedy target.
    modelRedirects: isHiddenBuiltinModelsResolved
      ? filterHiddenModelRedirects(modelRedirects, hiddenBuiltinModels)
      : {},
    runtimeConfig: isHiddenBuiltinModelsResolved ? runtimeState.runtimeConfig : {},
  };
};
