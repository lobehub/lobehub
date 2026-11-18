import type { ModelProviderCard } from '../types';

/**
 * Doubao Speech (Volcengine speech synthesis), text-to-speech only. This is a separate
 * service from Volcengine Ark (`volcengine`), with its own console and credentials: an
 * API key from the new speech console, or the legacy console's App ID + Access Token.
 * @see https://www.volcengine.com/docs/6561/2528925
 */
const DoubaoSpeech: ModelProviderCard = {
  apiKeyUrl: 'https://console.volcengine.com/speech/new',
  chatModels: [],
  description:
    'Doubao Speech (ByteDance Volcengine) synthesizes natural Mandarin and English speech with the Seed-TTS 2.0 model and official voices.',
  id: 'doubaospeech',
  modelsUrl: 'https://www.volcengine.com/docs/6561/1257544',
  name: 'Doubao Speech',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://openspeech.bytedance.com',
    },
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://www.volcengine.com/product/tts',
};

export default DoubaoSpeech;
