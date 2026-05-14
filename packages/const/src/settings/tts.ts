import type { UserTTSConfig } from '@lobechat/types';

export const DEFAULT_TTS_CONFIG: UserTTSConfig = {
  openAI: {
    sttModel: 'whisper-1',
    ttsModel: 'tts-1',
  },
  sttAutoStop: true,
  sttServer: 'openai',
  voiceCall: {
    autoSpeak: true,
    enabled: true,
    mode: 'hybrid',
    openAIRealtimeModel: 'gpt-realtime',
    provider: 'auto',
  },
  voiceInput: {
    enabled: true,
  },
};
