/** Feishu API allows max 50 messages per request. */
export const MAX_FEISHU_HISTORY_LIMIT = 50;

export const DEFAULT_FEISHU_CONNECTION_MODE = 'websocket';

/** Shared status emojis mapped to Feishu/Lark reaction identifiers. */
export const FEISHU_REACTION_TYPES: Record<string, string> = {
  '👀': 'Get',
  '🤔': 'THINKING',
  '⚡': 'OnIt',
};
