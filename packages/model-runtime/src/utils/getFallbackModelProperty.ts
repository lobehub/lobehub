import type { AiFullModelCard, AiModelType, LobeDefaultAiModelListItem } from 'model-bank';

import { EMBEDDING_MODEL_KEYWORDS } from './modelTypeKeywords';

interface BusinessModelConfigModule {
  loadModels: () => Promise<LobeDefaultAiModelListItem[]>;
}

const getDefaultModelType = (modelId: string): AiModelType => {
  const lowerModelId = modelId.toLowerCase();

  if (EMBEDDING_MODEL_KEYWORDS.some((keyword) => lowerModelId.includes(keyword))) {
    return 'embedding';
  }

  return 'chat';
};

/**
 * Get the model property value, first from the specified provider, and then from other providers as a fallback.
 * @param modelId The ID of the model.
 * @param propertyName The name of the property.
 * @param providerId Optional provider ID for an exact match.
 * @returns The property value or a default value.
 */
export const getModelPropertyWithFallback = async <T>(
  modelId: string,
  propertyName: keyof AiFullModelCard,
  providerId?: string,
): Promise<T> => {
  const { loadModels } =
    (await import('@lobechat/business-model-bank/model-config')) as BusinessModelConfigModule;
  const models = await loadModels();

  // Step 1: If providerId is provided, prioritize an exact match (same provider + same id)
  if (providerId) {
    const exactMatch = models.find((m) => m.id === modelId && m.providerId === providerId);

    if (exactMatch && exactMatch[propertyName] !== undefined) {
      return exactMatch[propertyName] as T;
    }
  }

  // Step 2: Fallback to a match ignoring the provider (match id only)
  const fallbackMatch = models.find((m) => m.id === modelId);

  if (fallbackMatch && fallbackMatch[propertyName] !== undefined) {
    return fallbackMatch[propertyName] as T;
  }

  // Step 3: Return a default value
  return (propertyName === 'type' ? getDefaultModelType(modelId) : undefined) as T;
};
