export type STTServer = 'openai' | 'browser';

export interface UserTTSConfig {
  cambAI: {
    ttsModel: 'mars-flash' | 'mars-pro';
  };
  openAI: {
    sttModel: 'whisper-1';
    ttsModel: 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd';
  };
  sttAutoStop: boolean;
  sttServer: STTServer;
}
