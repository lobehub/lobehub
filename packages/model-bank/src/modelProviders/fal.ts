import type { ModelProviderCard } from '../types';

/**
 * @see https://fal.ai/models/fal-ai/flux/schnell
 */
const Fal: ModelProviderCard = {
  chatModels: [],
  description: 'A generative media platform built for developers.',
  id: 'fal',
  // Fetching lists every fal image/video endpoint (any owner) with parameters from its schema
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://fal.ai/models',
  name: 'Fal',
  settings: {
    // fal serves no chat models, so the checker verifies the key against fal's platform API
    checkMode: 'credentials',
    disableBrowserRequest: true,
    showAddNewModel: false,
    showModelFetcher: true,
  },
  url: 'https://fal.ai',
};

export default Fal;
