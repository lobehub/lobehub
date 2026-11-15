import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type { DecisionResponse } from '@lobechat/model-runtime';
import type { ChannelMessageRoutingStatus, SignalDecisionVerdict } from '@lobechat/types';

import type {
  AppliedChannelRouting,
  ChannelRoutingDecision,
} from '@/database/repositories/channel';
import type { LobeChatDatabase } from '@/database/type';
import { recordSignalDecision } from '@/server/services/agentSignal/persistence/recordDecision';
import { ROUTING_JUDGE_POLICY_ID } from '@/server/services/conversationWake/judgeScore';

import type { ChannelRoutingInput, MemberWakeJudgement } from './wake';
import { CHANNEL_WAKE_PLATFORM } from './wake';

/** Revision of the Channel wake pipeline recorded on every decision. Bump when the judgement changes. */
export const CHANNEL_WAKE_PIPELINE_VERSION = 'channel-wake@1';

/** Policy id the decision model's answer is recorded under, beside the member's own rules. */
export const CHANNEL_ROUTING_POLICY_ID = ROUTING_JUDGE_POLICY_ID;

/** Every `finalReason` of a wake nobody asked for: the member may have stayed silent. */
export const CHANNEL_WAKE_FOLLOWUP_REASONS = [
  'followup-window',
  'in-duty',
  'named-in-text',
  'routing-deferred',
  'routing-uncertain',
] as const;

/** Longest message text stored in a signal payload. */
const MAX_PAYLOAD_TEXT_LENGTH = 4000;

/**
 * Where one Agent member's wake decisions are filed: a channel member is to Channel what a bot is
 * to an IM platform, so its decisions read like a bot's.
 */
export const channelWakeScopeKey = (channelId: string, memberId: string) =>
  `${CHANNEL_WAKE_PLATFORM}:${channelId}:${memberId}`;

/** What routing saw while it decided, for the decision rows. */
export interface ChannelRoutingTrace {
  answers?: DecisionResponse['answers'];
  judgements?: MemberWakeJudgement[];
}

const finalReasonFor = (
  decision: ChannelRoutingDecision,
  status: ChannelMessageRoutingStatus,
  chosen: boolean,
  memberId: string,
  judgement?: MemberWakeJudgement,
) => {
  if (chosen)
    return (
      (decision.status === 'assigned' ? decision.wakes?.[memberId]?.reason : undefined) ??
      'routing-selected'
    );
  if (judgement?.excluded) return 'excluded';
  return status === 'unassigned' ? 'unassigned' : 'not-chosen';
};

/**
 * Records one decision row per Agent member a routed message was judged for: its own rules'
 * verdicts and the decision model's answer, with whether it was woken and why. Fallback routing
 * judged nothing and records nothing.
 *
 * Rows are filed under the member's Agent owner and the channel's workspace, which is how its
 * wake records are read back. Never throws: a failed row is logged and dropped, like the bots'.
 */
export const recordChannelWakeDecisions = async (
  db: LobeChatDatabase,
  channelId: string,
  input: ChannelRoutingInput,
  decision: ChannelRoutingDecision,
  trace: ChannelRoutingTrace,
  applied: AppliedChannelRouting,
) => {
  if (input.fallback) return;

  // One row per member, one at a time: at most 20 candidates reach routing.
  for (const candidate of input.candidates) {
    if (!candidate.ownerId) continue;
    const { memberId } = candidate;
    const judgement = trace.judgements?.find((entry) => entry.memberId === memberId);
    // Delivered, not proposed: a member dropped by the resolver's membership recheck got nothing.
    const chosen = applied.status === 'assigned' && applied.recipients.includes(memberId);
    const answer = trace.answers?.[memberId];
    const finalReason = finalReasonFor(decision, applied.status, chosen, memberId, judgement);
    // A woken member either led the message or followed the primary responder's reply.
    const deferredBehind =
      decision.status === 'assigned' ? decision.wakes?.[memberId]?.afterMemberId : undefined;
    const verdicts: SignalDecisionVerdict[] = [
      ...(judgement?.verdicts ?? []),
      ...(answer?.type === 'boolean'
        ? [
            {
              confidence: answer.probability,
              latencyMs: 0,
              mode: 'enforce' as const,
              policyId: CHANNEL_ROUTING_POLICY_ID,
              reason: decision.reason,
              verdict: chosen ? ('allow' as const) : ('deny' as const),
              version: 1,
            },
          ]
        : []),
    ];

    try {
      await recordSignalDecision(db, {
        agentId: candidate.agentId,
        decision: {
          finalReason,
          metadata: {
            stateSnapshot: {
              excluded: judgement?.excluded ?? false,
              lastReplyAt: candidate.lastReplyAt ?? null,
              quiet: judgement?.quiet ?? false,
              silentWakes: candidate.silentWakes,
              ...(chosen && {
                responder: deferredBehind ? 'deferred' : 'primary',
                ...(deferredBehind && { primaryMemberId: deferredBehind }),
              }),
            },
          },
          outcome: chosen ? 'wake' : 'skip',
          pipelineVersion: CHANNEL_WAKE_PIPELINE_VERSION,
          toTag: finalReason,
          verdicts,
        },
        scopeKey: channelWakeScopeKey(channelId, memberId),
        signal: {
          // A retried routing judges the message again, so the attempt is part of the key.
          externalId: `${channelId}:${input.messageId}:${memberId}:${input.attempt}`,
          metadata: {
            address: {
              channelId,
              memberId,
              messageId: input.messageId,
              ...(input.threadId && { threadId: input.threadId }),
            },
            entryPoint: 'routing',
          },
          payload: { text: input.message.slice(0, MAX_PAYLOAD_TEXT_LENGTH) },
          source: CHANNEL_WAKE_PLATFORM,
          sourceType: AGENT_SIGNAL_SOURCE_TYPES.channelMessageRouted,
          type: AGENT_SIGNAL_SOURCE_TYPES.channelMessageRouted,
        },
        userId: candidate.ownerId,
        workspaceId: input.workspaceId ?? undefined,
      });
    } catch (error) {
      console.error('[channel:wake-record]', {
        channelId,
        memberId,
        error: error instanceof Error ? error.name : 'RecordError',
      });
    }
  }
};
