import type { ModelProviderCard } from '../types';

const AntGroup: ModelProviderCard = {
  chatModels: [],
  checkModel: 'Ling-2.6-flash',
  description:
    'Ant Ling is the core foundation model series of Ant Group’s Artificial General Intelligence (AGI) initiative, dedicated to building and opening up cutting-edge foundational model capabilities. We believe that the development of intelligence must move toward openness, sharing, and scalability—starting from small, practical steps to drive the steady evolution and real-world deployment of AGI.',
  id: 'antgroup',
  modelsUrl: 'https://developer.ant-ling.com/zh-CN/docs/models/',
  name: 'AntGroup',
  settings: {
    //disableBrowserRequest: false,
    sdkType: 'openai',
    showModelFetcher: false,
  },
  url: 'https://chat.ant-ling.com/open',
};

export default AntGroup;
