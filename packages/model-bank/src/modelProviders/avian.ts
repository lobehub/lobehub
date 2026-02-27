import type { ModelProviderCard } from '@/types/llm';

const Avian: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek/deepseek-v3.2',
  description:
    'Avian is an AI inference platform providing access to frontier open-source models with high performance and competitive pricing.',
  id: 'avian',
  name: 'Avian',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.avian.io/v1',
    },
    sdkType: 'openai',
  },
  url: 'https://avian.io',
};

export default Avian;
