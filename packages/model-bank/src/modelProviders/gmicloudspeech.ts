import type { ModelProviderCard } from '../types';

/**
 * Text-to-speech only. Requests go through GMI Cloud's multimodal request queue with a
 * bearer API key; generations are synchronous when the outcome is inline and polled
 * otherwise. Only WAV and MP3 output are supported.
 * @see https://docs.gmicloud.ai/guides-overview
 */
const GmicloudSpeech: ModelProviderCard = {
  apiKeyUrl: 'https://console.gmicloud.ai/',
  chatModels: [],
  description:
    'GMI Cloud hosts Inworld Realtime TTS, MiniMax speech synthesis and Resemble AI Chatterbox behind one multimodal request-queue API.',
  id: 'gmicloudspeech',
  modelsUrl: 'https://docs.gmicloud.ai/guides-overview',
  name: 'GMI Cloud Speech',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://console.gmicloud.ai',
    },
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://www.gmicloud.ai',
};

export default GmicloudSpeech;
