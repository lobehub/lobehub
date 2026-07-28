import type { AiProviderRuntimeState } from 'model-bank';

import { getHiddenBuiltinModelsForUser } from '@/business/server/aiProvider';
import { filterEnabledProvidersByModelType, filterHiddenBuiltinModels } from '@/utils/aiProvider';

/**
 * Resolves a user-scoped runtime state for server consumers that select or expose builtin models.
 * The repository state stays complete and cacheable; access filtering is applied to the returned copy.
 */
export const getUserScopedAiProviderRuntimeState = async (
  userId: string,
  loadRuntimeState: () => Promise<AiProviderRuntimeState>,
): Promise<AiProviderRuntimeState> => {
  const [runtimeState, hiddenBuiltinModels] = await Promise.all([
    loadRuntimeState(),
    getHiddenBuiltinModelsForUser(userId),
  ]);
  const enabledAiModels = filterHiddenBuiltinModels(
    runtimeState.enabledAiModels,
    hiddenBuiltinModels,
  );

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
    ...(hiddenBuiltinModels && { hiddenBuiltinModels }),
  };
};
