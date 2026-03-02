export type TTSServer = 'openai' | 'edge' | 'microsoft' | 'cambai';

export interface LobeAgentTTSConfig {
  showAllLocaleVoice?: boolean;
  sttLocale: 'auto' | string;
  ttsService: TTSServer;
  voice: {
    cambai?: string;
    edge?: string;
    microsoft?: string;
    openai: string;
  };
}
