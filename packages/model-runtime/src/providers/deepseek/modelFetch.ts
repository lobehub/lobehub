import type { ChatModelCard } from '@lobechat/types';
import type OpenAI from 'openai';

import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

interface DeepSeekModelCard {
  id: string;
}

export const fetchDeepSeekModels = async ({
  client,
}: {
  client: OpenAI | unknown;
}): Promise<ChatModelCard[]> => {
  const modelClient = client as {
    models?: { list?: () => Promise<{ data?: DeepSeekModelCard[] }> };
  };

  if (modelClient.models?.list) {
    const modelsPage = await modelClient.models.list();
    const modelList = modelsPage.data || [];

    return processModelList(modelList, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
  }

  const { deepseek } = await import('model-bank');

  return processModelList(deepseek, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
};
