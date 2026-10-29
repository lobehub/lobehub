import type { BotNoReplyResult, BotWakeKind } from '@lobechat/types';
import { BOT_STAND_DOWN_TOKEN, parseBotNoReplyToken } from '@lobechat/types';

/** `STAND_DOWN` ending the text, alone or after the reply, tolerating backticks / brackets. */
const STAND_DOWN_PATTERN = new RegExp(
  String.raw`(?:^|[\s\`\[(])${BOT_STAND_DOWN_TOKEN}[\`\])]*[.。]?\s*$`,
  'i',
);

/**
 * Splits the stand-down marker off a finished run's text: the agent ends its reply with
 * `STAND_DOWN` to step back from the conversation (people told it it is interfering).
 *
 * Returns:
 * - `standDown` whether the text ended with the marker
 * - `content` the text to post, without the marker; unchanged when there was none
 */
export const extractStandDown = (content?: string): { content?: string; standDown: boolean } => {
  const match = content ? STAND_DOWN_PATTERN.exec(content.trimEnd()) : null;
  if (!content || !match) return { content, standDown: false };

  return { content: content.slice(0, match.index).trimEnd(), standDown: true };
};

export interface DetectNoReplyInput {
  /** The run's final assistant text, as the agent wrote it (a stand-down marker included). */
  content?: string;
  hasAttachments?: boolean;
  /** Only a `followup` wake may end in silence; a `mention` always owes the user an answer. */
  wakeKind?: BotWakeKind;
}

/**
 * Whether a finished run chose silence instead of replying.
 *
 * - The agent ends with the `NO_REPLY[:reason]` token → silence with that reason (an unknown
 *   reason collapses to `unspecified`, so a made-up string never reaches the label store).
 * - A `followup` wake that produced nothing at all (no text, no attachments) → `empty_completion`.
 * - A `mention` wake is never silent: an empty completion there stays the fault it always was, and
 *   the token is just text.
 * - Standing down (`STAND_DOWN` with nothing before it, or `NO_REPLY:stand_down`) is silence with
 *   reason `stand_down`. The bare marker is silent on a `mention` wake too: there is nothing to post.
 *
 * Returns `undefined` when the run has something to deliver.
 */
export const detectNoReply = ({
  content,
  hasAttachments,
  wakeKind,
}: DetectNoReplyInput): BotNoReplyResult | undefined => {
  const ending = extractStandDown(content);
  const text = ending.content?.trim() ?? '';

  if (ending.standDown && !text && !hasAttachments) return { reason: 'stand_down' };
  if (wakeKind !== 'followup') return undefined;

  if (!text) return hasAttachments ? undefined : { reason: 'empty_completion' };

  const reason = parseBotNoReplyToken(text);
  if (!reason) return undefined;

  return { reason: ending.standDown ? 'stand_down' : reason };
};
