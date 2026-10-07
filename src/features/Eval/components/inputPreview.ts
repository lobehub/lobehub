/**
 * Channel messages (WeChat, Slack…) carry a `<speaker … />` envelope the model
 * needs but a reader does not. Strip it for display only — the stored input,
 * and what replay sends, keep it.
 */
export const stripSpeakerTags = (text: string): string =>
  text.replaceAll(/<speaker\b[^>]*\/>\s*/g, '').trim();
