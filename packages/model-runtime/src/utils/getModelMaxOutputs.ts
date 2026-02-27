import  { type AiFullModelCard } from 'model-bank';

/**
 * Get the max outputs for a specific model from the provider's model list
 * @param modelId The ID of the model
 * @param models The provider's model list to search in
 * @returns The max output value or undefined
 */
export const getModelMaxOutputs = (
  modelId: string,
  models: AiFullModelCard[],
): number | undefined => {
  const model = models.find((model) => model.id === modelId);
  return model ? model.maxOutput : undefined;
};
