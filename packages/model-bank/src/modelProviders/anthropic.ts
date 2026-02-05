import type { ModelProviderCard } from '@/types/llm';

const Anthropic: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-opus-4-5-20251101',
  description:
    'Anthropic builds advanced language models like Claude 3.5 Sonnet, Claude 3 Sonnet, Claude 3 Opus, and Claude 3 Haiku, balancing intelligence, speed, and cost for workloads from enterprise to rapid-response use cases.',
  enabled: true,
  id: 'anthropic',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models#model-names',
  name: 'Anthropic',
  proxyUrl: {
    placeholder: 'https://api.anthropic.com',
  },
  settings: {
    proxyUrl: {
      placeholder: 'https://api.anthropic.com',
    },
    responseAnimation: 'smooth',
    sdkType: 'anthropic',
    showModelFetcher: true,
  },
  url: 'https://anthropic.com',
};

export default Anthropic;
