import { matchesBotName } from '../conversation';
import type { WakePolicy, WakePolicyMode, WakePolicyResult, WakeRules } from '../types';

export const OWNER_RULES_POLICY_ID = 'bot-wake:owner-rules';

const deny = (reason: string): WakePolicyResult => ({
  confidence: 1,
  reason,
  tags: ['owner-rule', reason],
  verdict: 'deny',
});

/**
 * The bot owner's structured rules: scope, channel allow/deny lists, follow-up window, the
 * silent-wake budget and owner-presence suppression.
 *
 * Owner presence keeps the bot from joining chatter on its own while the owner is around to
 * answer. A message that calls the bot by name asked for the bot, not the owner, so presence does
 * not silence it. Scope and the channel lists still do: those say where the bot may speak at all.
 *
 * Free-text instructions are deliberately not read here. They are context for the classifier;
 * compiling prose into patterns would make the rule set say something the owner never wrote.
 *
 * Expects:
 * - `rules` is the output of `parseBotWakeSettings`, so every field is present and in range
 *
 * Returns:
 * - `deny` with the first rule that matched (checked in a fixed order: scope, deny list, allow
 *   list, window, budget, owner presence; owner presence is skipped when the text names the bot)
 * - `allow` when the bot spoke within the follow-up window, the author is the person whose message
 *   woke it there, and nothing denied
 * - `abstain` otherwise: outside the window, or for someone else in it, the owner's rules have no
 *   opinion
 */
export const createOwnerRulesPolicy = (mode: WakePolicyMode, rules: WakeRules): WakePolicy => ({
  evaluate: ({ signal, state }) => {
    const channel = state.channel;
    const ids = signal.channelKeys?.ids ?? [];
    const now = signal.timestamp;

    if (rules.scope === 'none') return deny('scope-none');

    if (ids.some((id) => rules.denyChannels.includes(id))) return deny('channel-denied');
    if (rules.allowChannels.length > 0 && !ids.some((id) => rules.allowChannels.includes(id))) {
      return deny('channel-not-allowed');
    }

    const windowOpen =
      channel?.followupUntil !== undefined
        ? channel.followupUntil > now
        : channel?.botLastSpokeAt !== undefined &&
          now - channel.botLastSpokeAt < rules.windowSeconds * 1000;

    if (rules.scope === 'bot-threads' && !windowOpen) return deny('outside-followup-window');

    // 0 means no budget: the bot never goes quiet on its own count.
    if (rules.maxSilentWakes > 0 && (channel?.silentWakes ?? 0) >= rules.maxSilentWakes) {
      return deny('budget-exhausted');
    }

    if (
      rules.ownerPresenceSeconds > 0 &&
      channel?.ownerLastSpokeAt !== undefined &&
      !signal.author?.isOwner &&
      now - channel.ownerLastSpokeAt < rules.ownerPresenceSeconds * 1000 &&
      !matchesBotName(signal.message, state.conversation?.botNames ?? [])
    ) {
      return deny('owner-present');
    }

    // The window follows up on the person the bot answered. Anyone else speaking in it, the owner
    // included, is more likely answering that person than the bot; the duty judge may still wake
    // it, for a message within the bot's duties.
    const partner = channel?.followupAuthorId;
    const followsUp = !partner || !signal.author || signal.author.id === partner;

    if (windowOpen && followsUp) {
      return {
        confidence: 0.6,
        reason: 'inside-followup-window',
        tags: ['owner-rule', 'followup-window'],
        verdict: 'allow',
      };
    }

    return {
      confidence: 0,
      reason: 'no-owner-rule-opinion',
      tags: ['owner-rule'],
      verdict: 'abstain',
    };
  },
  id: OWNER_RULES_POLICY_ID,
  mode,
  requires: ['channel', 'conversation'],
  version: 3,
});
