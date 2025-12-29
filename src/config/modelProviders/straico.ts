import { ModelProviderCard } from '@/types/llm';

const Straico: ModelProviderCard = {
  chatModels: [],
  checkModel: 'microsoft/phi-4',
  description:
    'Straico 致力于简化 AI 集成，通过提供一个整合了顶尖文本、图像和音频生成式 AI 模型的统一工作空间，赋能营销人员、企业家及爱好者等各类用户，实现对多样化 AI 工具的无缝访问。',
  id: 'straico',
  modelsUrl: 'https://straico.com/multimodel/',
  name: 'Straico',
  settings: {
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://straico.com',
};

export default Straico;
