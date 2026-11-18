import type { ChannelJobWake, SignalDecisionVerdict } from '@lobechat/types';

import type { ChannelRoutingRepository } from '@/database/repositories/channel';
import { parseBotWakeSettings } from '@/server/services/conversationWake/config';
import {
  CONVERSATION_PROMPT_LINES,
  toConversationLine,
} from '@/server/services/conversationWake/conversation';
import { isBotWakeEnabled } from '@/server/services/conversationWake/gate';
import type { WakeInitiation } from '@/server/services/conversationWake/initiation';
import {
  canInitiateWake,
  decideWakeInitiation,
} from '@/server/services/conversationWake/initiation';
import type { WakeClassify, WakeDutyJudge } from '@/server/services/conversationWake/policies';
import { createDutyPolicy, createWakePolicySet } from '@/server/services/conversationWake/policies';
import type {
  BotWakeConfig,
  WakeConversation,
  WakeSignal,
  WakeStateSnapshot,
} from '@/server/services/conversationWake/types';

export type ChannelRoutingInput = NonNullable<
  Awaited<ReturnType<ChannelRoutingRepository['claim']>>
>;
export type ChannelRoutingCandidate = ChannelRoutingInput['candidates'][number];

/** Platform name a Channel conversation is filed under in wake signals and decision rows. */
export const CHANNEL_WAKE_PLATFORM = 'lobehub';

/** Labels a member falls back to when it has no name of its own. */
const GENERIC_MEMBER_NAMES = new Set(['agent']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A member's reply strategy: the channel's defaults, then the member's own. Nested groups
 * (`rules`, `classifier`, `duties`, `scheduler`) merge field by field, so a member can change one
 * number without restating the rest.
 */
export const mergeWakeConfig = (
  channel: Record<string, unknown> | undefined,
  member: Record<string, unknown> | undefined,
): BotWakeConfig => {
  const merged: Record<string, unknown> = { ...channel, ...member };
  for (const key of ['classifier', 'duties', 'rules', 'scheduler'])
    if (isRecord(channel?.[key]) && isRecord(member?.[key]))
      merged[key] = { ...channel[key], ...member[key] };

  return merged as BotWakeConfig;
};

export interface MemberWakeJudgement {
  /**
   * Its own rules keep it out of every message nobody addressed to it: scope `none`, a channel
   * list that leaves this conversation out, or `bot-threads` outside a Thread it follows.
   * Routing does not choose it either.
   */
  excluded: boolean;
  /** Set when its own rules wake it (named in the text, a follow-up, a duty). */
  initiation?: WakeInitiation;
  memberId: string;
  /** Its silent-wake budget is spent: routing may still choose it, but not wake it on a hunch. */
  quiet: boolean;
  verdicts?: SignalDecisionVerdict[];
}

export interface JudgeMemberWakeDeps {
  /** "Is this message for the member?" Without it the follow-up window wakes unconfirmed. */
  classify?: WakeClassify;
  /** "Is this within the member's duties?" Without it duties never wake a member. */
  dutyJudge?: WakeDutyJudge;
  now: number;
}

/**
 * Runs one Agent member's own wake rules on an unaddressed Channel message: the same pipeline an
 * IM bot runs, with the state read from the channel instead of a platform.
 *
 * The member's id in the conversation is its Agent id, people are known by their user id, and the
 * follow-up window follows up on the person whose request the member last answered. Channel has
 * no owner presence or stand-down, so those rules never fire.
 */
export const judgeMemberWake = async (
  channelId: string,
  input: ChannelRoutingInput,
  candidate: ChannelRoutingCandidate,
  deps: JudgeMemberWakeDeps,
): Promise<MemberWakeJudgement> => {
  const settings = {
    botWake: { enabled: true, ...mergeWakeConfig(input.channelWake, candidate.wake) },
  };
  const { config, rules } = parseBotWakeSettings(settings);
  const ids = input.threadId ? [channelId, input.threadId] : [channelId];
  const outsideLists =
    ids.some((id) => rules.denyChannels.includes(id)) ||
    (rules.allowChannels.length > 0 && !ids.some((id) => rules.allowChannels.includes(id)));
  const judgement: MemberWakeJudgement = {
    excluded: rules.scope === 'none' || outsideLists,
    memberId: candidate.memberId,
    quiet: rules.maxSilentWakes > 0 && candidate.silentWakes >= rules.maxSilentWakes,
  };
  if (!isBotWakeEnabled(config) || judgement.excluded) return judgement;

  const policies = createWakePolicySet({ classify: deps.classify, settings });
  const dutyPolicy =
    deps.dutyJudge && rules.duties.text && rules.duties.mode !== 'off'
      ? createDutyPolicy(rules, deps.dutyJudge)
      : undefined;

  const recent = input.history.map((line) =>
    toConversationLine({
      at: line.at,
      authorId: line.authorId,
      authorName: line.author,
      id: line.id,
      isBot: line.isAgent,
      text: line.content,
    }),
  );
  const conversation: WakeConversation = {
    agent: { name: candidate.name, title: candidate.title },
    // The generic label of an unnamed member is a word, not a name: "agent" in a message is not
    // calling it.
    botNames: GENERIC_MEMBER_NAMES.has(candidate.name.trim().toLowerCase()) ? [] : [candidate.name],
    lastBotMessage: recent.findLast((line) => line.isBot && line.authorId === candidate.agentId)
      ?.text,
    recent: recent.slice(-CONVERSATION_PROMPT_LINES),
  };
  const signal: WakeSignal = {
    agentId: candidate.agentId,
    applicationId: candidate.agentId,
    author: { id: input.author.id, isBot: false, isMe: false, isOwner: false, isSystem: false },
    channelKeys: {
      channelKey: [CHANNEL_WAKE_PLATFORM, ...ids].join(':'),
      ids,
      ...(input.threadId && { threadKey: [CHANNEL_WAKE_PLATFORM, ...ids].join(':') }),
    },
    hasAttachments: input.hasAttachments,
    message: input.message,
    platform: CHANNEL_WAKE_PLATFORM,
    platformThreadId: [CHANNEL_WAKE_PLATFORM, ...ids].join(':'),
    timestamp: deps.now,
  };
  const snapshot: WakeStateSnapshot = {
    channel: {
      botLastSpokeAt: candidate.lastReplyAt,
      followupAuthorId: candidate.lastReplyToUserId,
      silentWakes: candidate.silentWakes,
    },
    conversation,
    explicitMention: false,
    replyToBot: false,
    // Thread candidates are its followers: the member is in the conversation.
    threadSubscribed: !!input.threadId,
  };

  // `bot-threads` speaks up only where it already takes part; routing must not drag it elsewhere.
  if (rules.scope === 'bot-threads' && !input.threadId) judgement.excluded = true;
  if (!canInitiateWake({ dutyPolicy, policies })) return judgement;

  const outcome = await decideWakeInitiation({
    dutyPolicy,
    policies,
    selfId: candidate.agentId,
    signal,
    snapshot,
  });

  return { ...judgement, initiation: outcome.initiation, verdicts: outcome.verdicts };
};

/** What the woken Agent is told about a wake its own rules started. */
export const toChannelJobWake = (initiation: WakeInitiation): ChannelJobWake => ({
  kind: 'followup',
  reason: initiation.reason,
  ...(initiation.reason === 'in-duty' && {
    duty: { helpful: initiation.helpful, matched: initiation.duty },
  }),
  ...(initiation.followup && {
    followup: {
      participants: initiation.followup.participants.map(({ isBot, isOwner, name }) => ({
        isBot,
        isOwner,
        name,
      })),
      score: initiation.followup.score,
    },
  }),
  ...(initiation.reason === 'named-in-text' && { named: true }),
});
