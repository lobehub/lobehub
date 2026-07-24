import type { ChatModelCard } from '@lobechat/types';
import type OpenAI from 'openai';

import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

interface DeepSeekModelCard {
  id: string;
}

interface DeepSeekModelFetchOptions {
  baseURL?: string;
  sdkType?: string;
}

const DEEPSEEK_ANTHROPIC_BASE_URL_PATTERN = /\/anthropic(?:\/v1\/messages)?\/?$/;

const shouldLoadStaticDeepSeekModels = ({ baseURL, sdkType }: DeepSeekModelFetchOptions = {}) => {
  if (sdkType) return sdkType === 'anthropic';

  return !baseURL || DEEPSEEK_ANTHROPIC_BASE_URL_PATTERN.test(baseURL);
};

const loadStaticDeepSeekModels = async () => {
  const { deepseek } = await import('model-bank');

  return processModelList(deepseek, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
};

export const fetchDeepSeekModels = async ({
  client,
  options,
}: {
  client: OpenAI | unknown;
  options?: DeepSeekModelFetchOptions;
}): Promise<ChatModelCard[]> => {
  if (shouldLoadStaticDeepSeekModels(options)) {
    return loadStaticDeepSeekModels();
  }

  const modelClient = client as {
    models?: { list?: () => Promise<{ data?: DeepSeekModelCard[] }> };
  };

  if (modelClient.models?.list) {
    const modelsPage = await modelClient.models.list();
    const modelList = modelsPage.data || [];

    return processModelList(modelList, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
  }

  return loadStaticDeepSeekModels();
};
