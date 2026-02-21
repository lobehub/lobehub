import type { ModelProviderCard } from '@/types/llm';

const Cerebras: ModelProviderCard = {
  chatModels: [],
  checkModel: 'llama3.1-8b',
  description:
    'Cerebras is an inference platform built on its CS-3 system, focused on ultra-low latency and high-throughput LLM service for real-time workloads like code generation and agent tasks.',
  id: 'cerebras',
  modelsUrl: 'https://inference-docs.cerebras.ai/models/overview',
  name: 'Cerebras',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.cerebras.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://cerebras.ai',
};

export default Cerebras;
