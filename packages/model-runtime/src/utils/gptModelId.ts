import { responsesAPIModels } from '../const/models';

export type GPT5ReasoningExtendParam =
  | 'gpt5ReasoningEffort'
  | 'gpt5_1ReasoningEffort'
  | 'gpt5_2ReasoningEffort';

export interface ParsedGPT5ModelId {
  majorVersion: 5;
  minorVersion?: number;
  normalizedModelId: string;
  variant?: string;
}

const GPT5_MODEL_PATTERN = /(?:^|\/)(gpt-5(?:\.(\d+))?(?:-([a-z][a-z0-9]*))?)(?:$|[-.:])/;

export const parseGPT5ModelId = (model: string): ParsedGPT5ModelId | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  const match = GPT5_MODEL_PATTERN.exec(normalized);
  if (!match) return;

  const [, normalizedModelId, minorVersion, variant] = match;

  return {
    majorVersion: 5,
    normalizedModelId,
    ...(minorVersion === undefined ? {} : { minorVersion: Number(minorVersion) }),
    ...(variant === undefined ? {} : { variant }),
  };
};

export const isGPT5Model = (model: string): boolean => !!parseGPT5ModelId(model);

export const isGPT5MinorAtLeast = (model: string, minorVersion: number): boolean => {
  const parsed = parseGPT5ModelId(model);

  return parsed?.minorVersion !== undefined && parsed.minorVersion >= minorVersion;
};

export const isGPT5MinorVersion = (model: string, minorVersion: number): boolean => {
  const parsed = parseGPT5ModelId(model);

  return parsed?.minorVersion === minorVersion;
};

export const isGPT5ProResponsesModel = (model: string): boolean => {
  return parseGPT5ModelId(model)?.variant === 'pro';
};

export const isResponsesAPIModel = (model: string): boolean => {
  if (responsesAPIModels.has(model)) return true;

  return isGPT5MinorAtLeast(model, 6);
};

export const resolveGPT5ReasoningExtendParam = (
  model: string,
): GPT5ReasoningExtendParam | undefined => {
  const parsed = parseGPT5ModelId(model);
  if (!parsed) return;

  if (parsed.minorVersion === undefined) return 'gpt5ReasoningEffort';
  if (parsed.minorVersion === 1) return 'gpt5_1ReasoningEffort';
  if (parsed.minorVersion >= 2) return 'gpt5_2ReasoningEffort';
};
