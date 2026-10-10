import type {
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalRolloutPolicy,
  GoalRolloutState,
} from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';

import { uncoveredAxisValues } from './spec';

/** Node states that mean a unit will never produce again. */
const TERMINAL_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

/** An external check's observed result, read by `tick` and handed in. */
export interface RolloutExternalCheckResult {
  passed: boolean;
  title: string;
}

export interface RolloutGateInput {
  /**
   * The external facts read for the declared checks. Absent means they have not
   * been evaluated yet — which blocks the gate rather than silently passing it.
   */
  externalChecks?: RolloutExternalCheckResult[];
  graph: Pick<GoalGraphSnapshot, 'edges' | 'nodes'>;
  policy: GoalRolloutPolicy;
  state: GoalRolloutState;
}

export interface RolloutGateResult {
  /** Reasons that keep the gate from passing; empty when `met` is true. */
  blockers: string[];
  met: boolean;
  /**
   * R3: true while the class-wide green still rests on the probe wave alone. The
   * probe wave distilled the Template from its own result, so it cannot be the
   * proof; a later, different wave must also run without a human before the
   * batch is fully trusted. Recorded rather than used to block, so wave 1 is not
   * deadlocked behind its own absence.
   */
  provisional: boolean;
}

const asBrief = (node: GoalGraphNode) => ({
  instruction: node.description ?? '',
  title: node.title,
});

/**
 * Whether a repeated batch has earned its next wave.
 *
 * Pure: every external fact (real CI, a real remote merge) arrives as
 * `externalChecks`, so the judgment can be replayed and tested like the rest of
 * `decideNextMove`. Five conditions, all of which must hold:
 *
 * 1. every probe settled without a person (no rejected / retired probe);
 * 2. no human decision is open anywhere in the batch;
 * 3. the Template is complete enough to apply (a recipe outline exists);
 * 4. every declared external check passed — the R1 anchor, so "the run
 *    finished" can never be the only evidence for a class-wide green;
 * 5. every declared variant axis value is represented among the probes (R4).
 */
export const evaluateRolloutGate = ({
  graph,
  policy,
  state,
  externalChecks,
}: RolloutGateInput): RolloutGateResult => {
  const blockers: string[] = [];
  const members = experimentMembers(graph, state.batchNodeId);
  const probeNodes = graph.nodes.filter((node) => state.probeNodeIds.includes(node.id));
  // R6 (per-item check): every released member — probe or mass — ends with a
  // check, so a rejection anywhere in the batch breaks it, not only a rejected
  // probe. Only the CURRENT round's members decide this gate: a member the
  // coordinator retired when re-opening the round (R5) is history, not a live
  // failure, and must not keep blocking the new canary.
  const roundIds = new Set([...state.probeNodeIds, ...(state.massNodeIds ?? [])]);
  const memberTaskNodes = graph.nodes.filter(
    (node) => roundIds.has(node.id) && node.kind === 'task',
  );

  const unsettled = memberTaskNodes.filter((node) => !TERMINAL_NODE_STATUSES.has(node.status));
  if (unsettled.length) blockers.push(`${unsettled.length} unit(s) have not settled`);

  const broken = memberTaskNodes.filter(
    (node) => node.status === 'rejected' || node.status === 'retired',
  );
  if (broken.length) blockers.push(`${broken.length} unit(s) did not succeed`);

  const openDecision = graph.nodes.find(
    (node) => members.has(node.id) && node.kind === 'decision' && node.status === 'waiting',
  );
  if (openDecision) blockers.push('a human decision is still open in this batch');

  const template = state.templateNodeId
    ? graph.nodes.find((node) => node.id === state.templateNodeId)
    : undefined;
  if (!template?.description?.trim()) blockers.push('the batch template is incomplete');

  const declared = policy.gate?.externalChecks ?? [];
  if (declared.length) {
    if (!externalChecks?.length) {
      blockers.push('the declared external checks have not been evaluated');
    } else {
      const failed = externalChecks.filter((check) => !check.passed);
      if (failed.length)
        blockers.push(`external check(s) failed: ${failed.map((check) => check.title).join(', ')}`);
    }
  }

  const gaps = uncoveredAxisValues(policy.spec?.variantAxes, probeNodes.map(asBrief));
  if (gaps.length) {
    blockers.push(`untested axes: ${gaps.map((gap) => `${gap.axis}=${gap.value}`).join(', ')}`);
  }

  return {
    blockers,
    met: blockers.length === 0,
    provisional: blockers.length === 0 && state.waveIndex === 0,
  };
};
