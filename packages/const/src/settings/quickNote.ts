import type { UserQuickNoteSettings } from '@lobechat/types';

/** Default scheduling and execution settings for Quick Note Analyze. */
export const DEFAULT_QUICK_NOTE_SETTINGS: UserQuickNoteSettings = {
  analyzeAgentId: null,
  autoAnalyze: {
    enabled: true,
    idleDelayMs: 6000,
  },
  maxAnalyzeSteps: 4,
};
