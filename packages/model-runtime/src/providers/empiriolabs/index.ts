import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const LobeEmpirioLabsAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.empiriolabs.ai/v1',
  debug: {
    chatCompletion: () => process.env.DEBUG_EMPIRIOLABS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = modelsPage.data || [];
    return processMultiProviderModelList(modelList, 'empiriolabs');
  },
  provider: ModelProvider.EmpirioLabs,
});
