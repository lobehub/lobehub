import type { ModelProviderCard } from '../types';

const XiaomiMiMo: ModelProviderCard = {
  chatModels: [],
  checkModel: 'mimo-v2.6-flash',
  description:
    'Xiaomi MiMo provides omni-modal conversational models with an OpenAI-compatible API, deep reasoning, tool calling, and a 1M-token context window.',
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
