import { matchesBotName } from '../conversation';
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
 * wake the bot on their own, and the one message that always is.
 *
 * - System, self and other-bot messages (a bot answering a bot is how two bots loop)
 * - `@everyone`, `@here` and role-only pings that name no one in particular. The chat SDK's
 *   Discord adapter reports these as `isMention`; this re-judges them from the text
 * - A message that @-mentions someone else but not the bot is addressed to that person
 * - Blank, punctuation-only and emoji-only messages
 *
 * A message that gets past all of that and calls the bot by name is addressed to it, whoever
 * wrote it.
 *
 * Returns:
 * - `deny` with the first rule that matched
 * - `allow` (`named-in-text`) when the text names the bot. Needs the bot's names; without them
 *   the rule has nothing to match and abstains
 * - `abstain` otherwise: passing the internal rules is not, by itself, a reason to speak
 */
export const createInternalRulesPolicy = (mode: WakePolicyMode): WakePolicy => ({
  evaluate: ({ signal, state }) => {
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

    if (matchesBotName(signal.message, state.conversation?.botNames ?? [])) {
      return {
        confidence: 0.9,
        reason: 'named-in-text',
        tags: ['internal-rule', 'named-in-text'],
        verdict: 'allow',
      };
    }

    return {
      confidence: 0,
      reason: 'no-internal-rule-hit',
      tags: ['internal-rule'],
      verdict: 'abstain',
    };
  },
  id: INTERNAL_RULES_POLICY_ID,
  mode,
  requires: ['conversation'],
  version: 2,
});
