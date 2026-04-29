import type { AiModelType } from 'model-bank';

import { lobehubChatModels } from './chat';
import { lobehubEmbeddingModels } from './embedding';
import { lobehubImageModels } from './image';
import { lobehubVideoModels } from './video';

export const allModels = [
  ...lobehubChatModels,
  ...lobehubEmbeddingModels,
  ...lobehubImageModels,
  ...lobehubVideoModels,
];

export const findLobeHubModel = (id: string) => allModels.find((m) => m.id === id);

export const isLobeHubModelAvailable = (id: string, expectedType: AiModelType) => {
  const model = findLobeHubModel(id);
  return !!model && model.type === expectedType;
};
