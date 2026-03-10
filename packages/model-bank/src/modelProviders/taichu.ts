import type { ModelProviderCard } from '@/types/llm';

const Taichu: ModelProviderCard = {
  chatModels: [],
  checkModel: 'taichu_llm',
  description:
    'A next-generation multimodal model from CASIA and the Wuhan Institute of AI, supporting multi-turn QA, writing, image generation, 3D understanding, and signal analysis with stronger cognition and creativity.',
  id: 'taichu',
  modelsUrl: 'https://cloud.zidongtaichu.com/taichu/maas/#/modellist',
  name: 'Taichu',
  settings: {
    proxyUrl: {
      placeholder: 'https://cloud.zidongtaichu.com/maas/v1',
    },
    sdkType: 'openai',
  },
  url: 'https://cloud.zidongtaichu.com/taichu/maas',
};

export default Taichu;
