import type { ModelProviderCard } from '../types';

/**
 * Text-to-speech only. Requests carry the key as `Authorization: Bearer`, and the model is
 * chosen with the `model` request header.
 * @see https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 */
const FishAudio: ModelProviderCard = {
  apiKeyUrl: 'https://fish.audio/app/api-keys',
  chatModels: [],
  description:
    'Fish Audio offers expressive multilingual text-to-speech (S2.1 Pro, Drama 3) with natural-language delivery directions and voice cloning.',
  id: 'fishaudio',
  modelsUrl: 'https://docs.fish.audio/developer-guide/models-pricing/models-overview',
  name: 'Fish Audio',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.fish.audio',
    },
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://fish.audio',
};

export default FishAudio;
