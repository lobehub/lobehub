import { type ModelProviderCard } from '@/types/llm';

const XiaomiMiMo: ModelProviderCard = {
  chatModels: [],
  checkModel: 'mimo-v2-flash',
  description:
    'Xiaomi MiMo 提供 OpenAI 兼容接口的对话模型服务。mimo-v2-flash 支持深度思考、流式输出与函数调用，256K 上下文，最大输出 128K。',
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
