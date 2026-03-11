import type { ModelProviderCard } from '@/types/llm';

// ref: https://ai.google.dev/gemini-api/docs/models/gemini
const Google: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gemini-3-flash-preview',
  description:
    "Google's Gemini family is its most advanced general-purpose AI, built by Google DeepMind for multimodal use across text, code, images, audio, and video. It scales from data centers to mobile devices with strong efficiency and reach.",
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
