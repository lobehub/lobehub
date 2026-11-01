import type { CommandHandler } from './types';

/**
 * /newTopic — Force the message to be sent in a brand-new topic,
 * regardless of the current topic context.
 */
export const newTopicHandler: CommandHandler = () => {
  return { forceNewTopic: true };
};

/**
 * /compact — Compress the current conversation context.
 * Triggers a history summarization instead of normal AI response.
 */
export const compactHandler: CommandHandler = () => {
  return { triggerCompression: true };
};
