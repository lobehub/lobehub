import { type RuntimeVideoGenParamsKeys } from 'model-bank';

import { type VideoGenerationConfigState } from './initialState';

const model = (s: VideoGenerationConfigState) => s.model;
const provider = (s: VideoGenerationConfigState) => s.provider;

const parameters = (s: VideoGenerationConfigState) => s.parameters;
const parametersSchema = (s: VideoGenerationConfigState) => s.parametersSchema;
const isSupportedParam = (paramName: RuntimeVideoGenParamsKeys) => {
  return (s: VideoGenerationConfigState) => {
    const _parametersSchema = parametersSchema(s);
    return Boolean(paramName in _parametersSchema);
  };
};

export const videoGenerationConfigSelectors = {
  isSupportedParam,
  model,
  parameters,
  parametersSchema,
  provider,
};
