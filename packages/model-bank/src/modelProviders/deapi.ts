import type { ModelProviderCard } from '../types';

/**
 * deAPI serves image and video models through an OpenAI-compatible gateway
 * (images/generations, images/edits, videos). It has no chat completions, so
 * `chatModels` stays empty and the media catalog lives in `aiModels/deapi.ts`.
 *
 * @see https://docs.deapi.ai/openai-compatibility
 */
const DeAPI: ModelProviderCard = {
  apiKeyUrl: 'https://app.deapi.ai/register',
  chatModels: [],
  description:
    'deAPI runs open-source image and video models such as FLUX and LTX-Video on a distributed GPU network at low per-generation prices.',
  id: 'deapi',
  modelsUrl: 'https://docs.deapi.ai/models',
  name: 'deAPI',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://oai.deapi.ai/v1',
    },
    sdkType: 'openai',
    showAddNewModel: false,
    showChecker: false,
    // `/v1/models` also lists TTS, transcription and embedding models, which
    // would be added as chat models; the media cards are curated instead.
    showModelFetcher: false,
  },
  url: 'https://deapi.ai',
};

export default DeAPI;
