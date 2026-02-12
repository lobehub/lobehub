import type { ModelProviderCard } from '@/types/llm';

const Higress: ModelProviderCard = {
  chatModels: [],
  checkModel: 'qwen-max',
  description:
    'Higress is a cloud-native API gateway created inside Alibaba to address Tengine reload impact on long-lived connections and gaps in gRPC/Dubbo load balancing.',
  id: 'higress',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://higress.cn/',
  name: 'Higress',
  proxyUrl: {
    desc: 'Enter the Higress AI Gateway endpoint.',
    placeholder: 'https://127.0.0.1:8080/v1',
    title: 'AI Gateway URL',
  },
  settings: {
    proxyUrl: {
      desc: 'Enter the Higress AI Gateway endpoint.',
      placeholder: 'https://127.0.0.1:8080/v1',
      title: 'AI Gateway URL',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://apig.console.aliyun.com/',
};

export default Higress;
