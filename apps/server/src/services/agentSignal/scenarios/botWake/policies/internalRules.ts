import { isEmptyOrEmojiOnly } from '../facts';
import type { WakePolicy, WakePolicyMode, WakePolicyResult } from '../types';

export const INTERNAL_RULES_POLICY_ID = 'bot-wake:internal-rules';

const deny = (reason: string): WakePolicyResult => ({
  confidence: 1,
  reason,
  tags: ['internal-rule', reason],
  verdict: 'deny',
});

/**
 * Rules the product owns and the owner cannot switch off: messages that are never a reason to
 * wake the bot on their own.
 *
 * - System, self and other-bot messages (a bot answering a bot is how two bots loop)
 * - `@everyone`, `@here` and role-only pings that name no one in particular. The chat SDK's
 *   Discord adapter reports these as `isMention`; this re-judges them from the text
 * - A message that @-mentions someone else but not the bot is addressed to that person
 * - Blank, punctuation-only and emoji-only messages
 *
 * Returns:
 * - `deny` with the first rule that matched, or `abstain` when none did. It never allows: passing
 *   the internal rules is not a reason to speak.
 */
export const createInternalRulesPolicy = (mode: WakePolicyMode): WakePolicy => ({
  evaluate: ({ signal }) => {
    const { author, hasAttachments, mentions } = signal;

    if (author?.isSystem) return deny('system-message');
    if (author?.isMe) return deny('self-message');
    if (author?.isBot) return deny('bot-message');

    if (mentions && !mentions.botMentioned) {
      if (mentions.everyone || mentions.here) return deny('broadcast-mention');
      if (mentions.roleIds.length > 0 && mentions.otherUserIds.length === 0) {
        return deny('role-only-mention');
      }
      if (mentions.otherUserIds.length > 0) return deny('mentions-someone-else');
    }

    if (isEmptyOrEmojiOnly(signal.message, hasAttachments)) return deny('empty-or-emoji-only');

    return {
      confidence: 0,
      reason: 'no-internal-rule-hit',
      tags: ['internal-rule'],
      verdict: 'abstain',
    };
  },
  id: INTERNAL_RULES_POLICY_ID,
  mode,
  requires: [],
  version: 1,
});
