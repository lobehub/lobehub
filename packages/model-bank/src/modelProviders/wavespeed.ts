import type { ModelProviderCard } from '../types';

/**
 * @see https://wavespeed.ai/docs
 */
const WaveSpeed: ModelProviderCard = {
  chatModels: [],
  description:
    'WaveSpeed AI is an inference platform for image, video and audio generation, serving flagship open and closed models through one fast, low-latency API.',
  id: 'wavespeed',
  name: 'WaveSpeed AI',
  settings: {
    disableBrowserRequest: true,
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://wavespeed.ai',
};

export default WaveSpeed;
