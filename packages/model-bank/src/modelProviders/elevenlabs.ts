import type { ModelProviderCard } from '../types';

/**
 * Text-to-speech only. Requests carry the key in the `xi-api-key` header; the base URL
 * can point at a data-residency host instead of the global API.
 * @see https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
const ElevenLabs: ModelProviderCard = {
  apiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  chatModels: [],
  description:
    'ElevenLabs is an AI audio company whose text-to-speech models generate lifelike, expressive speech in 90+ languages, with a large voice library and voice cloning.',
  id: 'elevenlabs',
  modelsUrl: 'https://elevenlabs.io/docs/overview/models',
  name: 'ElevenLabs',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.elevenlabs.io',
    },
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://elevenlabs.io',
};

export default ElevenLabs;
