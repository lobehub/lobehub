import type { ModelProviderCard } from '@/types/llm';

// ref :https://ai-maas.wair.ac.cn/#/doc
const Taichu: ModelProviderCard = {
  chatModels: [],
  checkModel: 'taichu_llm',
  description:
    'A next-generation multimodal model from CASIA and the Wuhan Institute of AI, supporting multi-turn QA, writing, image generation, 3D understanding, and signal analysis with stronger cognition and creativity.',
  id: 'taichu',
  modelsUrl: 'https://ai-maas.wair.ac.cn/#/doc',
  name: 'Taichu',
  settings: {
    proxyUrl: {
      placeholder: 'https://ai-maas.wair.ac.cn/maas/v1',
    },
    sdkType: 'openai',
  },
  url: 'https://ai-maas.wair.ac.cn',
};

export default Taichu;
