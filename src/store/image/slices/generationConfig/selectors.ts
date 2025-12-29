import { RuntimeImageGenParamsKeys } from 'model-bank';

import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';

import { GenerationConfigState } from './initialState';

export const model = (s: GenerationConfigState) => s.model;
export const provider = (s: GenerationConfigState) => s.provider;
export const imageNum = (s: GenerationConfigState) => s.imageNum;
export const enabledSearch = (s: GenerationConfigState) => s.enabledSearch;

const parameters = (s: GenerationConfigState) => s.parameters;
const parametersSchema = (s: GenerationConfigState) => s.parametersSchema;
const isSupportedParam = (paramName: RuntimeImageGenParamsKeys) => {
  return (s: GenerationConfigState) => {
    const _parametersSchema = parametersSchema(s);
    return Boolean(paramName in _parametersSchema);
  };
};

const isSupportSearch = (s: GenerationConfigState) => {
  const currentModel = model(s);
  const currentProvider = provider(s);

  // 从 aiInfra store 获取模型配置
  const imageModelCard = aiModelSelectors.getEnabledModelById(
    currentModel,
    currentProvider,
  )(getAiInfraStoreState());

  // 检查模型是否支持搜索（仅图片模型）
  return imageModelCard?.type === 'image' && imageModelCard?.abilities?.search === true;
};

export const imageGenerationConfigSelectors = {
  model,
  provider,
  imageNum,
  enabledSearch,
  isSupportedParam,
  isSupportSearch,
  parameters,
  parametersSchema,
};
