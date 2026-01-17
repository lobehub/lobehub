import { ModelProvider } from 'model-bank';

import {
    type OpenAICompatibleFactoryOptions,
    createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';

export const params = {
    baseURL: 'https://api.n1n.ai/v1',
    provider: ModelProvider.N1N,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeN1NAI = createOpenAICompatibleRuntime(params);
