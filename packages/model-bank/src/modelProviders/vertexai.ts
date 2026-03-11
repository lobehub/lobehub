import type { ModelProviderCard } from '@/types/llm';

// ref: https://ai.google.dev/gemini-api/docs/models/gemini
const VertexAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gemini-3-flash-preview',
  description:
    "Google's Gemini family is its most advanced general-purpose AI, built by Google DeepMind for multimodal use across text, code, images, audio, and video. It scales from data centers to mobile devices, improving efficiency and deployment flexibility.",
  id: 'vertexai',
  modelsUrl: 'https://console.cloud.google.com/vertex-ai/model-garden',
  name: 'Vertex AI',
  settings: {
    disableBrowserRequest: true,
    responseAnimation: 'smooth',
    showModelFetcher: false,
  },
  url: 'https://cloud.google.com/vertex-ai',
};

export default VertexAI;
