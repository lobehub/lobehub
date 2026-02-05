import type {RuntimeImageGenParamsKeys} from 'model-bank';

import type {GenerationConfigState} from './initialState';

export const model = (s: GenerationConfigState) => s.model;
export const provider = (s: GenerationConfigState) => s.provider;
export const imageNum = (s: GenerationConfigState) => s.imageNum;

const parameters = (s: GenerationConfigState) => s.parameters;
const parametersSchema = (s: GenerationConfigState) => s.parametersSchema;
const isSupportedParam = (paramName: RuntimeImageGenParamsKeys) => {
  return (s: GenerationConfigState) => {
    const _parametersSchema = parametersSchema(s);
    return Boolean(paramName in _parametersSchema);
  };
};

export const imageGenerationConfigSelectors = {
  model,
  provider,
  imageNum,
  isSupportedParam,
  parameters,
  parametersSchema,
};
