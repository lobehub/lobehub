export interface ParsedGLMModelId {
  majorVersion: number;
  minorVersion?: number;
  normalizedModelId: string;
}

const GLM_BASE_MODEL_PATTERN = /^glm-(\d+)(?:\.(\d+))?$/;

const parseMinorVersion = (value: string | undefined): Pick<ParsedGLMModelId, 'minorVersion'> => {
  if (!value) return {};

  return {
    minorVersion: Number(value),
  };
};

export const parseGLMModelId = (model: string): ParsedGLMModelId | undefined => {
  const normalizedModelId = model.trim().toLowerCase();
  if (!normalizedModelId) return;

  const match = GLM_BASE_MODEL_PATTERN.exec(normalizedModelId);
  if (!match) return;

  const [, majorVersion, minorVersion] = match;

  return {
    majorVersion: Number(majorVersion),
    normalizedModelId,
    ...parseMinorVersion(minorVersion),
  };
};

export const isToolStreamSupportedGLMModel = (model: string): boolean => {
  const parsed = parseGLMModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion >= 5) return true;

  return parsed.majorVersion === 4 && parsed.minorVersion !== undefined && parsed.minorVersion >= 6;
};
