import {
  gmicloudInworldTTSSchema,
  gmicloudInworldTTSVoices,
  gmicloudMinimaxTTSSchema,
  gmicloudMinimaxTTSVoices,
} from '../const/ttsParameters';
import type { AITTSModelCard } from '../types/aiModel';

/**
 * GMI Cloud speech models. Requests go through GMI Cloud's multimodal request queue;
 * generations are synchronous when the outcome is inline and polled otherwise.
 * Prices are the on-demand per-character rates published on GMI Cloud's model pages.
 * @see https://docs.gmicloud.ai/guides-overview
 */
const gmicloudSpeechTTSModels: AITTSModelCard[] = [
  {
    description:
      'Inworld real-time text-to-speech served by GMI Cloud: low-latency speech well suited to conversational voice, with WAV and MP3 output.',
    displayName: 'Inworld TTS 2',
    enabled: true,
    id: 'inworld-tts-2',
    isOfficial: true,
    parameters: gmicloudInworldTTSSchema,
    // $25 per 1M characters, on-demand.
    // @see https://docs.gmicloud.ai/model-quickstarts/audio/inworld-tts-2-flash
    pricing: {
      units: [{ name: 'textInput', rate: 25, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: gmicloudInworldTTSVoices,
  },
  {
    description:
      'MiniMax speech synthesis served by GMI Cloud. Generations go through the request queue and are usually quick, but an occasional request runs long; Inworld is the low-latency option.',
    displayName: 'MiniMax Speech 2.8 Turbo',
    enabled: true,
    id: 'minimax-tts-speech-2.8-turbo',
    isOfficial: true,
    parameters: gmicloudMinimaxTTSSchema,
    // $0.06 per 1,000 characters ($60 per 1M).
    // @see https://docs.gmicloud.ai/model-quickstarts/audio/minimax-tts-speech-2-8-turbo
    pricing: {
      units: [{ name: 'textInput', rate: 60, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: gmicloudMinimaxTTSVoices,
  },
];

export default gmicloudSpeechTTSModels;
