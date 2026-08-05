export type TTSServer = 'openai';

export interface LobeAgentTTSConfig {
  showAllLocaleVoice?: boolean;
  sttLocale: 'auto' | string;
  ttsService: TTSServer;
  voice: {
    openai: string;
  };
}
