export type TTSServer = 'openai';

export interface LobeAgentTTSConfig {
  showAllLocaleVoice?: boolean;
  ttsService: TTSServer;
  voice: {
    openai: string;
  };
}
