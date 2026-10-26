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
 * Free-text instructions are deliberately not read here. They are context for the classifier;
 * compiling prose into patterns would make the rule set say something the owner never wrote.
 *
 * Expects:
 * - `rules` is the output of `parseBotWakeSettings`, so every field is present and in range
 *
 * Returns:
 * - `deny` with the first rule that matched (checked in a fixed order: scope, deny list, allow
 *   list, window, budget, owner presence)
 * - `allow` when the bot spoke within the follow-up window and nothing denied
 * - `abstain` otherwise: outside the window the owner's rules have no opinion
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
      now - channel.ownerLastSpokeAt < rules.ownerPresenceSeconds * 1000
    ) {
      return deny('owner-present');
    }

    if (windowOpen) {
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
  requires: ['channel'],
  version: 1,
});
