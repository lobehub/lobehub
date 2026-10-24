import type { ModelProviderCard } from '../types';

// ref: https://gateway.dothoosh.com/docs
const DotHoosh: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-flash',
  description:
    'DotHoosh is an Iranian AI API gateway. One API key reaches Claude, GPT, Gemini, DeepSeek, and Kimi models through OpenAI-compatible and Anthropic-compatible endpoints, billed in Toman from a prepaid wallet.',
  disableBrowserRequest: true,
  id: 'dothoosh',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://gateway.dothoosh.com/models',
  name: 'DotHoosh',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://gateway.dothoosh.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://gateway.dothoosh.com',
};

export default DotHoosh;
