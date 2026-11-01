/** Feishu API allows max 50 messages per request. */
export const MAX_FEISHU_HISTORY_LIMIT = 50;

export const DEFAULT_FEISHU_CONNECTION_MODE = 'websocket';

/**
 * Cap on the docx body returned by `readDocument`. Meeting minutes run a few
 * thousand characters; this leaves room for long specs without letting one
 * tool result eat the whole context window.
 */
export const MAX_FEISHU_DOCUMENT_CHARS = 60_000;
