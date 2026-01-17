import { type ModelProviderCard } from '@/types/llm';

const N1N: ModelProviderCard = {
    apiKeyUrl: 'https://n1n.ai',
    chatModels: [],
    checkModel: 'gpt-4o_repeat_n1n',
    description:
        'N1N is an aggregated AI model provider offering access to top-tier models like GPT-4o, Claude 3.5, and Gemini 1.5 Pro.',
    enabled: true,
    id: 'n1n',
    modelList: { showModelFetcher: true },
    modelsUrl: 'https://docs.n1n.ai/llm-api-quickstart',
    name: 'N1N AI',
    settings: {
        responseAnimation: 'smooth',
        showModelFetcher: true,
        supportResponsesApi: true,
    },
    url: 'https://n1n.ai',
};

export default N1N;
