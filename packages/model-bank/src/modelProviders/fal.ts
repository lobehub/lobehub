import type { ModelProviderCard } from '../types';

/**
 * @see https://fal.ai/models/fal-ai/flux/schnell
 */
const Fal: ModelProviderCard = {
  chatModels: [],
  description: 'A generative media platform built for developers.',
  id: 'fal',
  name: 'Fal',
  settings: {
    disableBrowserRequest: true,
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://fal.ai',
};

export default Fal;
