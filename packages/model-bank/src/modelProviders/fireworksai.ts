import type { ModelProviderCard } from '@/types/llm';

// ref: https://fireworks.ai/models?show=Serverless
// ref: https://fireworks.ai/pricing
const FireworksAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'accounts/fireworks/models/llama-v3p2-3b-instruct',
  description:
    'Fireworks AI provides advanced language model services with function calling and multimodal processing. Firefunction V2 (based on Llama-3) is optimized for function calls, chat, and instruction following, while FireLLaVA-13B supports mixed image-text inputs. Other notable models include the Llama and Mixtral families.',
  id: 'fireworksai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://fireworks.ai/models?show=Serverless',
  name: 'Fireworks AI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.fireworks.ai/inference/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://fireworks.ai',
};

export default FireworksAI;
