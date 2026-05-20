export interface MappedBusinessModelFields {
  modelId: string;
  providerId: string;
  requestedModelId?: string;
}

export interface ResolvedBusinessModel {
  requestedModelId?: string;
  resolvedModelId: string;
}

interface BuildMappedBusinessModelFieldsParams {
  provider: string;
  requestedModelId?: string;
  resolvedModelId: string;
}

export const buildMappedBusinessModelFields = ({
  provider,
  requestedModelId,
  resolvedModelId,
}: BuildMappedBusinessModelFieldsParams): MappedBusinessModelFields => ({
  modelId: resolvedModelId,
  providerId: provider,
  ...(requestedModelId ? { requestedModelId } : {}),
});

export const resolveBusinessModelMapping = async (
  _provider: string,
  model: string,
): Promise<ResolvedBusinessModel> => {
  return {
    resolvedModelId: model,
  };
};
