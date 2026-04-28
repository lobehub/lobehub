import { type ModelProviderCard } from '@/types/llm';

const StreamLake: ModelProviderCard = {
  chatModels: [],
  checkModel: 'KAT-Coder-Air-V1',
  description:
    'StreamLake is an enterprise-level model service and AI computing cloud platform, integrating high-performance model inference, low-cost model customization, and fully-managed services to help enterprises focus on AI application innovation without worrying about the complexity and cost of underlying computing resources.',
  id: 'streamlake',
  modelsUrl: 'https://www.streamlake.com/document/WANQING/mdrax1ixkgpgh1ms1na',
  name: 'StreamLake',
  settings: {
    //disableBrowserRequest: false,
    proxyUrl: {
      placeholder: 'https://wanqing.streamlakeapi.com/api/gateway/v1/endpoints',
    },
    sdkType: 'openai',
    showModelFetcher: false,
  },
  url: 'https://www.streamlake.com/product/wanqing',
};

export default StreamLake;
