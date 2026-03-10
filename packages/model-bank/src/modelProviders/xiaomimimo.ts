import type { ModelProviderCard } from '@/types/llm';

const XiaomiMiMo: ModelProviderCard = {
  chatModels: [],
  checkModel: 'mimo-v2-flash',
  description:
    'Xiaomi MiMo provides a conversational model service with an OpenAI-compatible API. The mimo-v2-flash model supports deep reasoning, streaming output, function calling, a 256K context window, and a maximum output of 128K.',
  id: 'xiaomimimo',
  modelList: { showModelFetcher: true },
  name: 'Xiaomi MiMo',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://api.xiaomimimo.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://platform.xiaomimimo.com/',
};

export default XiaomiMiMo;
