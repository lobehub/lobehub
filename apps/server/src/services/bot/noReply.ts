import type { BotNoReplyReason, BotNoReplyResult, BotWakeKind } from '@lobechat/types';
import { BOT_NO_REPLY_REASONS, BOT_NO_REPLY_TOKEN } from '@lobechat/types';

const REASONS = new Set<string>(BOT_NO_REPLY_REASONS);

/** `NO_REPLY`, `NO_REPLY:duplicate`, tolerating backticks / brackets and a trailing period. */
const NO_REPLY_PATTERN = new RegExp(
  String.raw`^[\s\`\[(]*${BOT_NO_REPLY_TOKEN}(?:\s*[:：]\s*([a-z_]+))?[\s\`\])]*[.。]?\s*$`,
  'i',
);

export interface DetectNoReplyInput {
  /** The run's final assistant text. */
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
 *
 * Returns `undefined` when the run has something to deliver.
 */
export const detectNoReply = ({
  content,
  hasAttachments,
  wakeKind,
}: DetectNoReplyInput): BotNoReplyResult | undefined => {
  if (wakeKind !== 'followup') return undefined;

  const text = content?.trim() ?? '';

  if (!text) return hasAttachments ? undefined : { reason: 'empty_completion' };

  const match = NO_REPLY_PATTERN.exec(text);
  if (!match) return undefined;

  const raw = match[1]?.toLowerCase();
  // `empty_completion` is detected by us, never claimed by the agent.
  const reason: BotNoReplyReason =
    raw && REASONS.has(raw) && raw !== 'empty_completion'
      ? (raw as BotNoReplyReason)
      : 'unspecified';

  return { reason };
};
