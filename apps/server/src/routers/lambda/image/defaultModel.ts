import type { AiProviderRuntimeState } from 'model-bank';
import { isAiModelVisible } from 'model-bank/aiModel';

import type { EnabledImageProviderModels } from '@/utils/defaultImageModel';

/**
 * Server counterpart of the client store's `enabledImageModelList`: enabled image providers with
 * their enabled, visible image models, in the same order the image page lists them. Expects a
 * user-scoped runtime state so models hidden from the user are already removed.
 */
export const buildEnabledImageProviderModels = (
  state: Pick<AiProviderRuntimeState, 'enabledAiModels' | 'enabledImageAiProviders'>,
): EnabledImageProviderModels[] =>
  state.enabledImageAiProviders.map((provider) => ({
    children: state.enabledAiModels
      .filter(
        (model) =>
          model.providerId === provider.id && model.type === 'image' && isAiModelVisible(model),
      )
      .map((model) => ({ id: model.id })),
    id: provider.id,
  }));
