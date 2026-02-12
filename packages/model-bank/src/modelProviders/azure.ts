import type { ModelProviderCard } from '@/types/llm';

// ref: https://learn.microsoft.com/azure/ai-services/openai/concepts/models
const Azure: ModelProviderCard = {
  chatModels: [],
  defaultShowBrowserRequest: true,
  description:
    'Azure offers advanced AI models, including GPT-3.5 and GPT-4 series, for diverse data types and complex tasks with a focus on safe, reliable, and sustainable AI.',
  id: 'azure',
  modelsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/concepts/models',
  name: 'Azure OpenAI',
  settings: {
    defaultShowBrowserRequest: true,
    sdkType: 'azure',
    showDeployName: true,
  },
  url: 'https://azure.microsoft.com',
};

export default Azure;
