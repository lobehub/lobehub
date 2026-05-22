import type { AiModelType, LobeDefaultAiModelListItem } from './types';

export const isProviderModelAvailable = (
  models: LobeDefaultAiModelListItem[],
  providerId: string,
  id: string,
  expectedType: AiModelType,
): boolean =>
  models.some(
    (model) =>
      model.providerId === providerId &&
      model.id === id &&
      model.enabled !== false &&
      model.type === expectedType,
  );
