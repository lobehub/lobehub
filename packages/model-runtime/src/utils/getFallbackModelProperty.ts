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
 * Progressively shorter readings of a model id, longest first.
 *
 * Ids that reach this function routinely carry a routing namespace the model bank
 * knows nothing about. Gateways and OpenAI-compatible proxies publish their
 * catalogue under a prefix — `openrouter/deepseek/deepseek-v4-pro`,
 * `tensorx/z-ai/glm-5.3` — and a proxy fronting a vendor directly may hand out
 * the vendor prefix alone, as in `anthropic/claude-haiku-4-5`. The bank only ever
 * stores the unprefixed id, so the exact matches above miss and every property
 * comes back `undefined`.
 *
 * That is not a cosmetic miss. `undefined` is what makes callers fall back to
 * their own defaults, and the most expensive one is `AgentRuntimeService`
 * dropping the model's real `contextWindowTokens`: `tokenCounter` then compresses
 * against `DEFAULT_MAX_CONTEXT` (128k) for a model that actually has a 1M
 * window. Trimming the namespace restores the real value.
 *
 * Longest-first ordering matters: `deepseek/deepseek-v4-pro` is a more specific
 * claim about the model than `deepseek-v4-pro`, so it gets asked first.
 */
const getNamespacedIdCandidates = (modelId: string): string[] => {
  const segments = modelId.split('/');

  if (segments.length < 2) return [];

  return segments.slice(1).map((_, index) => segments.slice(index + 1).join('/'));
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

  // Step 3: Retry without the routing namespace. Tried last so a real card for
  // the literal id always wins over a trimmed reading of it.
  for (const candidate of getNamespacedIdCandidates(modelId)) {
    const namespacedMatch = models.find((m) => m.id === candidate);

    if (namespacedMatch && namespacedMatch[propertyName] !== undefined) {
      return namespacedMatch[propertyName] as T;
    }
  }

  // Step 4: Return a default value
  return (propertyName === 'type' ? getDefaultModelType(modelId) : undefined) as T;
};
