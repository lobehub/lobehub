import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.minimaxi.com/document/Models
const Minimax: ModelProviderCard = {
  chatModels: [],
  checkModel: 'MiniMax-M2.1',
  description:
    'Founded in 2021, MiniMax builds general-purpose AI with multimodal foundation models, including trillion-parameter MoE text models, speech models, and vision models, along with apps like Hailuo AI.',
  id: 'minimax',
  modelsUrl: 'https://platform.minimaxi.com/document/Models',
  name: 'Minimax',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://api.minimaxi.com/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
  },
  url: 'https://www.minimaxi.com',
};

export default Minimax;
