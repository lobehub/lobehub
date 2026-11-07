import { matchesBotName } from '../conversation';
import type { WakePolicy, WakePolicyMode, WakePolicyResult, WakeRules } from '../types';

export const OWNER_RULES_POLICY_ID = 'bot-wake:owner-rules';

/**
 * How long the person the bot answered may come back to it in a thread the bot is subscribed to,
 * after the window closed: pasting the link it asked for eight minutes later is still the same
 * exchange. The classifier still has to confirm, as in the window.
 */
export const THREAD_FOLLOWUP_MS = 30 * 60 * 1000;

const deny = (reason: string): WakePolicyResult => ({
  confidence: 1,
  reason,
  tags: ['owner-rule', reason],
  verdict: 'deny',
});

/**
 * The bot owner's structured rules: scope, channel allow/deny lists, a stand-down, follow-up
 * window, the silent-wake budget and owner-presence suppression.
 *
 * A stand-down is the bot stepping back after people told it it was interfering. Until it ends,
 * every wake nobody explicitly addressed to the bot is denied, its name in the text included:
 * being mentioned in passing ("nasa 就在这瞎捣乱") is exactly what it stepped back from. An
 * @-mention or a reply to it never reaches the policies (the fast path), so those still wake it.
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
 *   list, stand-down (`stood-down`), window, budget, owner presence; owner presence is skipped when
 *   the text names the bot)
 * - `allow` when the bot spoke within the follow-up window, the author is the person whose message
 *   woke it there, and nothing denied (`inside-followup-window`); also for the owner answering the
 *   bot's own line in the window (`owner-answers-bot`), and for that person coming back within
 *   {@link THREAD_FOLLOWUP_MS} in a thread the bot is subscribed to, with nobody else in between
 *   (`thread-followup`)
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

    if (channel?.standDownUntil !== undefined && channel.standDownUntil > now) {
      return deny('stood-down');
    }

    const windowOpen =
      channel?.followupUntil !== undefined
        ? channel.followupUntil > now
        : channel?.botLastSpokeAt !== undefined &&
          now - channel.botLastSpokeAt < rules.windowSeconds * 1000;

    const partner = channel?.followupAuthorId;
    const authorId = signal.author?.id;
    const isPartner = !partner || !authorId || authorId === partner;
    // The line right before this one: the bot's own, or someone else joining in.
    const previous = state.conversation?.recent.at(-1);
    const answersBot =
      previous !== undefined && previous.isBot && previous.authorId === signal.applicationId;
    const threadFollowup =
      !windowOpen &&
      state.threadSubscribed === true &&
      partner !== undefined &&
      authorId === partner &&
      channel?.botLastSpokeAt !== undefined &&
      now - channel.botLastSpokeAt < THREAD_FOLLOWUP_MS &&
      (previous === undefined || answersBot || previous.authorId === authorId);

    if (rules.scope === 'bot-threads' && !windowOpen && !threadFollowup) {
      return deny('outside-followup-window');
    }

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

    const followup = (reason: string): WakePolicyResult => ({
      confidence: 0.6,
      reason,
      tags: ['owner-rule', 'followup-window'],
      verdict: 'allow',
    });

    // The window follows up on the person the bot answered. Anyone else speaking in it is more
    // likely answering that person than the bot; the duty judge may still wake it, for a message
    // within the bot's duties. The owner speaking right after the bot's own line is the exception:
    // the bot works for them, and the classifier still has to confirm it is for the bot.
    if (windowOpen && isPartner) return followup('inside-followup-window');
    if (windowOpen && signal.author?.isOwner && answersBot) return followup('owner-answers-bot');
    if (threadFollowup) return followup('thread-followup');

    return {
      confidence: 0,
      reason: 'no-owner-rule-opinion',
      tags: ['owner-rule'],
      verdict: 'abstain',
    };
  },
  id: OWNER_RULES_POLICY_ID,
  mode,
  requires: ['channel', 'conversation', 'threadSubscribed'],
  version: 5,
});
