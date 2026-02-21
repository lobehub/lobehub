import type { ModelProviderCard } from '@/types/llm';

// ref: https://learn.microsoft.com/azure/ai-services/openai/concepts/models
const Azure: ModelProviderCard = {
  chatModels: [],
  description:
    'Azure provides advanced AI models, including GPT-3.5 and GPT-4 series, for diverse data types and complex tasks with a focus on safe, reliable, and sustainable AI.',
  id: 'azureai',
  modelsUrl: 'https://ai.azure.com/explore/models',
  name: 'Azure AI',
  settings: {
    defaultShowBrowserRequest: true,
    sdkType: 'azureai',
    showDeployName: true,
  },
  url: 'https://ai.azure.com',
};

export default Azure;
