import type { SignalDecisionVerdict } from '@lobechat/types';

import { aggregateWakeVerdictsAsync } from './aggregator';
import type { WakeParticipant } from './conversation';
import { conversationParticipants } from './conversation';
import {
  CLASSIFIER_POLICY_ID,
  DUTY_HELPFUL_TAG,
  DUTY_POLICY_ID,
  OWNER_RULES_POLICY_ID,
} from './policies';
import type { WakeDecision, WakePolicy, WakeSignal, WakeStateSnapshot } from './types';

/** The reasons a participant can be woken for a message nobody addressed to it. */
export type WakeInitiationReason = 'followup-window' | 'in-duty' | 'named-in-text';

/**
 * What each way of starting a wake on its own means for how the wake is handled.
 *
 * - `addressed`: the message is meant for the participant (it says its name), so it is answered at
 *   once like an @mention. A collect window is for merging a burst of chatter nobody addressed;
 *   making someone who called the participant wait for it only makes it look dead.
 *
 * Declared here, where the reason is decided, and read by callers as a fact about the initiation:
 * a new reason does not compile until it says what it is, and no call site has to remember to
 * list it.
 */
const INITIATION_TRAITS: Record<WakeInitiationReason, { addressed: boolean }> = {
  'followup-window': { addressed: false },
  // Nobody asked: it waits like any other unaddressed wake, and may end in silence.
  'in-duty': { addressed: false },
  'named-in-text': { addressed: true },
};

/**
 * `followup-window` only: what the woken agent is told about a follow-up nobody addressed to it,
 * so it can tell a message for it from one for someone else in a busy conversation.
 */
export interface WakeFollowupContext {
  /** Who else took part in the conversation lately, newest first; names only. */
  participants: WakeParticipant[];
  /** 0..1: how sure the addressed classifier was that the message is for the participant. */
  score?: number;
}

/** A wake started without anyone addressing the participant: the rule that started it. */
export interface WakeInitiation {
  /** See {@link INITIATION_TRAITS}. */
  addressed: boolean;
  /** `in-duty` only: the duty the message falls within, when the judge named one. */
  duty?: string;
  /** `followup-window` only. See {@link WakeFollowupContext}. */
  followup?: WakeFollowupContext;
  /**
   * `in-duty` only: woken because stepping in would help (an open question nobody answered that the
   * participant can settle), not because the message falls within the duties.
   */
  helpful?: boolean;
  reason: WakeInitiationReason;
}

/** What a wake carries for the agent besides its reason. */
export type WakeInitiationDetails = Pick<WakeInitiation, 'duty' | 'followup' | 'helpful'>;

export const isWakeInitiationReason = (value: unknown): value is WakeInitiationReason =>
  typeof value === 'string' && value in INITIATION_TRAITS;

export const initiationFor = (
  reason: WakeInitiationReason,
  { duty, followup, helpful }: WakeInitiationDetails = {},
): WakeInitiation => ({
  ...INITIATION_TRAITS[reason],
  ...(duty && { duty }),
  ...(followup && { followup }),
  ...(helpful && { helpful }),
  reason,
});

/** A decision's per-policy records in the shape a decision row stores. */
export const toWakeVerdicts = (decision: WakeDecision): SignalDecisionVerdict[] =>
  decision.records.map((record) => ({
    confidence: record.confidence,
    latencyMs: record.latencyMs,
    mode: record.mode,
    policyId: record.policyId,
    reason: record.reason,
    verdict: record.verdict,
    version: record.policyVersion,
  }));

export interface WakeInitiationPolicies {
  /**
   * Model judge for a message within the participant's duties. Absent when it has no duties or
   * the judge is off.
   */
  dutyPolicy?: WakePolicy;
  /** The rule policies and, optionally, the addressed classifier. */
  policies: readonly WakePolicy[];
}

/**
 * Whether {@link decideWakeInitiation} could ever start a wake with these policies: some rule
 * enforces, or there is a duty judge. Checked before any state is read.
 */
export const canInitiateWake = ({ dutyPolicy, policies }: WakeInitiationPolicies): boolean =>
  !!dutyPolicy ||
  policies.some((policy) => policy.id !== CLASSIFIER_POLICY_ID && policy.mode === 'enforce');

export interface DecideWakeInitiationInput extends WakeInitiationPolicies {
  /** The participant's own id in the conversation, to tell its lines from everyone else's. */
  selfId: string;
  signal: WakeSignal;
  snapshot: WakeStateSnapshot;
}

export interface WakeInitiationOutcome {
  /** Set when the participant should be woken. */
  initiation?: WakeInitiation;
  /**
   * The verdicts of the policies that ran, for the decision row. Absent when the rules stopped
   * short without a deny: the row then replays them as observers.
   */
  verdicts?: SignalDecisionVerdict[];
}

/**
 * Decides whether to wake a participant for a message nobody addressed to it. Pure apart from
 * the model calls inside the policies: the caller reads the state, and keeps or persists the
 * outcome.
 *
 * In order:
 * 1. The rule policies. The text naming the participant (`named-in-text`) wakes it with no model
 *    call; the follow-up window opens the way for step 2. An enforcing deny keeps it quiet.
 * 2. Inside the window, an enforcing classifier must agree; a degraded one is not a yes, and a
 *    shadow one only scores.
 * 3. When no rule had an opinion (or only the owner's presence held it back), or the classifier
 *    declined, the duty judge may still wake it for a message within its duties.
 */
export const decideWakeInitiation = async ({
  dutyPolicy,
  policies,
  selfId,
  signal,
  snapshot,
}: DecideWakeInitiationInput): Promise<WakeInitiationOutcome> => {
  /** Asks the duty judge, after everything else declined. Adds its verdict to `verdicts`. */
  const judgeDuty = async (verdicts: SignalDecisionVerdict[]): Promise<WakeInitiationOutcome> => {
    if (!dutyPolicy) return { verdicts };

    const judged = await aggregateWakeVerdictsAsync([dutyPolicy], signal, snapshot);
    verdicts.push(...toWakeVerdicts(judged));

    // A shadow judge only scores; a degraded one abstains, so it never lands here.
    if (dutyPolicy.mode === 'enforce' && judged.verdict === 'allow') {
      const record = judged.records.find((entry) => entry.policyId === DUTY_POLICY_ID);

      return {
        initiation: initiationFor('in-duty', {
          duty: record?.matched,
          helpful: record?.tags.includes(DUTY_HELPFUL_TAG),
        }),
        verdicts,
      };
    }

    return { verdicts };
  };

  const rulePolicies = policies.filter((policy) => policy.id !== CLASSIFIER_POLICY_ID);
  const rulesEnforce = rulePolicies.some((policy) => policy.mode === 'enforce');
  const ruleDecision = await aggregateWakeVerdictsAsync(rulePolicies, signal, snapshot);

  if (!rulesEnforce || ruleDecision.verdict !== 'allow' || ruleDecision.fastPath) {
    // Nothing addressed the participant and no rule allowed it: not named, outside the follow-up
    // window. Only when no rule had an opinion either way, whatever the rules' mode: a deny (a
    // channel list, the silent-wake budget) still keeps it out. Owner presence is the exception:
    // it keeps the participant out of chatter the owner can answer, not off its duties. Logging a
    // feature request does not wait for the owner to go quiet.
    const onlyOwnerPresent =
      ruleDecision.verdict === 'deny' &&
      ruleDecision.decidedBy === OWNER_RULES_POLICY_ID &&
      ruleDecision.reason === 'owner-present' &&
      ruleDecision.records.every(
        (record) => record.policyId === OWNER_RULES_POLICY_ID || record.verdict === 'abstain',
      );
    const undecided =
      !ruleDecision.fastPath &&
      (onlyOwnerPresent || ruleDecision.records.every((record) => record.verdict === 'abstain'));

    if (!undecided || !dutyPolicy) {
      // An enforcing deny is what kept the participant quiet: keep its verdicts, so the row names
      // the rule that stopped the wake instead of replaying every policy as if it only watched.
      return {
        verdicts: ruleDecision.verdict === 'deny' ? toWakeVerdicts(ruleDecision) : undefined,
      };
    }

    return judgeDuty(toWakeVerdicts(ruleDecision));
  }

  const verdicts = toWakeVerdicts(ruleDecision);

  // Said by name: no need to ask a model whether it was meant for the participant.
  if (ruleDecision.reason === 'named-in-text') {
    return { initiation: initiationFor('named-in-text'), verdicts };
  }

  // Only the window is open. A classifier the owner enforces must confirm; one that only watches
  // is scored for the record and does not stand in the way.
  const classifier = policies.find((policy) => policy.id === CLASSIFIER_POLICY_ID);
  let score: number | undefined;
  if (classifier) {
    const classified = await aggregateWakeVerdictsAsync([classifier], signal, snapshot);
    verdicts.push(...toWakeVerdicts(classified));

    // A classifier that failed or ran out of budget passes in `degraded`: when the owner relies
    // on it, no answer is not a yes. Not a follow-up to the participant, the message may still
    // fall within its duties.
    const degraded = classified.records.some((record) => record.tags.includes('degraded'));
    if (classifier.mode === 'enforce' && (classified.verdict !== 'allow' || degraded)) {
      return judgeDuty(verdicts);
    }
    if (!degraded) score = classified.records[0]?.confidence;
  }

  // The agent is told why it woke: how sure the classifier was, and who else is talking.
  return {
    initiation: initiationFor('followup-window', {
      followup: { participants: conversationParticipants(snapshot.conversation, selfId), score },
    }),
    verdicts,
  };
};
