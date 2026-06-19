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
  provider: string,
  model: string,
): Promise<ResolvedBusinessModel> => {
  if (provider !== 'lobehub') {
    return {
      resolvedModelId: model,
    };
  }

  const mapping = parseModelMapping(process.env.ACENSUS_AI_MODEL_MAPPING);
  const resolvedModelId = mapping[model] ?? model;

  return {
    ...(resolvedModelId !== model ? { requestedModelId: model } : {}),
    resolvedModelId,
  };
};

const parseModelMapping = (value: string | undefined): Record<string, string> => {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
};
