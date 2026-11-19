import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createSteadyRouterImage } from './createImage';

export interface SteadyRouterModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.steadyrouter.com/v1',
  createImage: createSteadyRouterImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_STEADYROUTER_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: AgentRuntimeErrorType.InvalidProviderAPIKey,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: SteadyRouterModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'steadyrouter');
  },
  provider: ModelProvider.SteadyRouter,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSteadyRouterAI = createOpenAICompatibleRuntime(params);
