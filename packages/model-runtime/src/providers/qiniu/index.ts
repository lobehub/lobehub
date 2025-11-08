import { ModelProvider } from 'model-bank';

import {
  OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  apiKey: 'placeholder-to-avoid-error',
  baseURL: 'https://openai.qiniu.com/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_QINIU_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = modelsPage.data.map((model: any) => {
      // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
      const { created, ...rest } = model;
      return rest;
    });

    // 自动检测模型提供商并选择相应配置
    return processMultiProviderModelList(modelList, 'qiniu');
  },
  provider: ModelProvider.Qiniu,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeQiniuAI = createOpenAICompatibleRuntime(params);
