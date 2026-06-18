export const hasDuplicateModelId = (id: string | undefined, existingModelIds: string[]) => {
  const modelId = id?.trim();
  if (!modelId) return false;

  return existingModelIds.includes(modelId);
};
