import type { ModelProviderCard } from '../types';

// ref: https://router.sokkan.ch/docs
const Sokkan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'openai/gpt-oss-20b',
  description:
    'SOKKAN Router is an OpenAI-compatible inference gateway operated by NINABOT Sàrl (Geneva, Switzerland), serving open-weight Qwen and gpt-oss models from EU and Swiss regions with prepaid billing.',
  id: 'sokkan',
  modelsUrl: 'https://router.sokkan.ch/models',
  name: 'SOKKAN Router',
  settings: {
    proxyUrl: {
      placeholder: 'https://router.sokkan.ch/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://router.sokkan.ch',
};

export default Sokkan;
