import type { ModelProviderCard } from '@/types/llm';

// ref https://console.groq.com/docs/tool-use
const Groq: ModelProviderCard = {
  chatModels: [],
  checkModel: 'llama-3.1-8b-instant',
  description:
    'Groq’s LPU inference engine delivers standout benchmark performance with exceptional speed and efficiency, setting a high bar for low-latency, cloud-based LLM inference.',
  id: 'groq',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://console.groq.com/docs/models',
  name: 'Groq',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.groq.com/openai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://groq.com',
};

export default Groq;
