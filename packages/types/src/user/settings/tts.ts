export type STTServer = 'openai' | 'browser';
export type VoiceCallMode = 'browser' | 'provider' | 'hybrid';
export type VoiceCallProvider = 'auto' | 'openai' | 'gemini' | 'xai' | 'openrouter';
export type OpenAIRealtimeModel =
  | 'gpt-realtime'
  | 'gpt-4o-realtime-preview'
  | 'gpt-4o-mini-realtime-preview';

export interface UserTTSConfig {
  openAI: {
    sttModel: 'whisper-1';
    ttsModel: 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd';
  };
  sttAutoStop: boolean;
  sttServer: STTServer;
  voiceCall: {
    autoSpeak: boolean;
    enabled: boolean;
    mode: VoiceCallMode;
    openAIRealtimeModel: OpenAIRealtimeModel;
    provider: VoiceCallProvider;
  };
  voiceInput: {
    enabled: boolean;
  };
}
