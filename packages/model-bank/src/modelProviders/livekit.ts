import type { ModelProviderCard } from '../types';

const LiveKit: ModelProviderCard = {
  apiKeyUrl: 'https://cloud.livekit.io',
  chatModels: [],
  checkModel: 'google/gemma-4-31b-it',
  description: 'LiveKit Inference provides language models through one LiveKit Cloud project.',
  id: 'livekit',
  modelsUrl: 'https://docs.livekit.io/agents/models/inference/',
  name: 'LiveKit',
  settings: {
    disableBrowserRequest: true,
    showAddNewModel: false,
    showModelFetcher: false,
  },
  url: 'https://livekit.io',
};

export default LiveKit;
