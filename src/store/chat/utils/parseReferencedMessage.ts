import { cleanSpeakerTag } from './cleanSpeakerTag';

/**
 * The quoted / replied-to message an IM bot inbound carries ahead of the
 * user's own text. Written by the server's `formatReferencedMessage` as
 * `<referenced_message sender="…">…</referenced_message>` so the model knows
 * what the user was answering; it is prompt markup, not something to show raw.
 */
export interface ReferencedMessage {
  /** Fragment the user explicitly quoted (Telegram "quote" replies). */
  selectedQuote?: string;
  sender: string;
  /** Full text of the referenced message when the platform provides it. */
  text?: string;
}

/**
 * Matches the referenced block at the start of the content (after any
 * `<speaker … />` tag). The body is non-greedy so a user who literally types
 * `</referenced_message>` later cannot swallow their own text into the quote.
 */
const REFERENCED_MESSAGE_REGEX =
  /^\s*<referenced_message sender="([^"]*)">([\S\s]*?)<\/referenced_message>\n?/;
const FULL_MESSAGE_REGEX = /<full_message>([\S\s]*?)<\/full_message>/;
const SELECTED_QUOTE_REGEX = /<selected_quote>([\S\s]*?)<\/selected_quote>/;

const parseInner = (sender: string, inner: string): ReferencedMessage => {
  const full = FULL_MESSAGE_REGEX.exec(inner)?.[1];
  const quote = SELECTED_QUOTE_REGEX.exec(inner)?.[1];
  if (full === undefined && quote === undefined) return { sender, text: inner };
  return { selectedQuote: quote, sender, text: full };
};

/**
 * Split a user message into the referenced (quoted) block and the text the
 * user actually typed. Returns the content untouched as `body` when no block
 * is present.
 */
export const splitReferencedMessage = (
  content: string,
): { body: string; reference?: ReferencedMessage } => {
  const match = REFERENCED_MESSAGE_REGEX.exec(content);
  if (!match) return { body: content };
  return {
    body: content.slice(match[0].length),
    reference: parseInner(match[1], match[2]),
  };
};

/**
 * Strip every bot-prompt tag (`<speaker … />`, `<referenced_message>`) from a
 * user message, leaving only what the user typed. Use for copy / re-edit paths
 * where the quote is context, not the user's words.
 */
export const cleanBotPromptTags = (content: string): string =>
  splitReferencedMessage(cleanSpeakerTag(content)).body;
