export interface ModelIdMappingOptions {
  modelIdMapping?: Record<string, string>;
}

export const resolveMappedModelId = (model: string, options?: ModelIdMappingOptions) =>
  options?.modelIdMapping?.[model] ?? model;

export const withMappedModelId = <T extends { model: string }>(
  payload: T,
  options?: ModelIdMappingOptions,
): T => {
  const model = resolveMappedModelId(payload.model, options);

  return model === payload.model ? payload : { ...payload, model };
};
