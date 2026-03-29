import type { FieldSchema } from './types';

/** Default debounce window (ms) for message batching. */
export const DEFAULT_DEBOUNCE_MS = 2000;

/** Maximum debounce window (ms) allowed across all platforms. */
export const MAX_DEBOUNCE_MS = 30_000;

/**
 * Common settings field: owner's platform user ID.
 * Used by the AI to send direct messages to the bot owner without asking for the ID.
 */
export const userIdField: FieldSchema = {
  key: 'userId',
  description: 'channel.userIdHint',
  label: 'channel.userId',
  type: 'string',
};
