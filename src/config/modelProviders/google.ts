import { ModelProviderCard } from '@/types/llm';

const Google: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gemini-2.0-flash',
  description:
    'Google 的 Gemini 系列是其最先进、通用的 AI模型，由 Google DeepMind 打造，专为多模态设计，支持文本、代码、图像、音频和视频的无缝理解与处理。适用于从数据中心到移动设备的多种环境，极大提升了AI模型的效率与应用广泛性。',
  enabled: true,
  id: 'google',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini',
  name: 'Google',
  proxyUrl: {
    placeholder: 'https://generativelanguage.googleapis.com',
  },
  settings: {
    proxyUrl: {
      placeholder: 'https://generativelanguage.googleapis.com',
    },
    responseAnimation: {
      speed: 50,
      text: 'smooth',
    },
    sdkType: 'google',
    showModelFetcher: true,
  },
  url: 'https://ai.google.dev',
};

export default Google;
