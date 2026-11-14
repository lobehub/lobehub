import { type ModelProviderCard } from '../types';

// ref: https://platform.minimaxi.com/document/Models
const Minimax: ModelProviderCard = {
  chatModels: [],
  // MiniMax retired the M2 line (M2, M2.1, M2.5, M2.7 and their highspeed
  // variants answer 404 / 2069), so the check uses the current M3 model.
  checkModel: 'MiniMax-M3',
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
    showModelFetcher: false,
  },
  url: 'https://www.minimaxi.com',
};

export default Minimax;
