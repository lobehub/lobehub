import { type RuntimeImageGenParamsKeys } from 'model-bank';

import { type GenerationConfigState } from './initialState';

export const model = (s: GenerationConfigState) => s.model;
export const provider = (s: GenerationConfigState) => s.provider;
export const imageNum = (s: GenerationConfigState) => s.imageNum;
const uploadingImagePreviews = (s: GenerationConfigState) => s.uploadingImagePreviews;

const parameters = (s: GenerationConfigState) => s.parameters;
const parametersSchema = (s: GenerationConfigState) => s.parametersSchema;
const isSupportedParam = (paramName: RuntimeImageGenParamsKeys) => {
  return (s: GenerationConfigState) => {
    const _parametersSchema = parametersSchema(s);
    return Boolean(paramName in _parametersSchema);
  };
};

/**
 * Whether the current model will produce an animated GIF. GIF output is generation-only (the
 * OpenAI edit endpoint rejects it), so it excludes reference images.
 */
const isAnimatedOutput = (s: GenerationConfigState) =>
  isSupportedParam('outputFormat')(s) && s.parameters?.outputFormat === 'gif';

export const imageGenerationConfigSelectors = {
  model,
  provider,
  imageNum,
  isAnimatedOutput,
  isSupportedParam,
  parameters,
  parametersSchema,
  uploadingImagePreviews,
};
