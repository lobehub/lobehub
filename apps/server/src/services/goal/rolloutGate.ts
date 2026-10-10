import type {
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalRolloutGateCheck,
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
  /** Every condition judged, passed or not — what the gate log records. */
  checks: GoalRolloutGateCheck[];
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
  const checks: GoalRolloutGateCheck[] = [];
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
  const total = memberTaskNodes.length;

  const unsettled = memberTaskNodes.filter((node) => !TERMINAL_NODE_STATUSES.has(node.status));
  checks.push({
    count: total - unsettled.length,
    key: 'units_settled',
    nodeIds: unsettled.length ? unsettled.map((node) => node.id) : undefined,
    passed: unsettled.length === 0,
    total,
  });
  if (unsettled.length) blockers.push(`${unsettled.length} unit(s) have not settled`);

  const broken = memberTaskNodes.filter(
    (node) => node.status === 'rejected' || node.status === 'retired',
  );
  checks.push({
    count: total - broken.length,
    key: 'units_succeeded',
    nodeIds: broken.length ? broken.map((node) => node.id) : undefined,
    passed: broken.length === 0,
    total,
  });
  if (broken.length) blockers.push(`${broken.length} unit(s) did not succeed`);

  const openDecision = graph.nodes.find(
    (node) => members.has(node.id) && node.kind === 'decision' && node.status === 'waiting',
  );
  checks.push({
    key: 'no_open_decision',
    nodeIds: openDecision ? [openDecision.id] : undefined,
    passed: !openDecision,
  });
  if (openDecision) blockers.push('a human decision is still open in this batch');

  const template = state.templateNodeId
    ? graph.nodes.find((node) => node.id === state.templateNodeId)
    : undefined;
  const planWritten = !!template?.description?.trim();
  checks.push({
    key: 'plan_written',
    nodeIds: template ? [template.id] : undefined,
    passed: planWritten,
  });
  if (!planWritten) blockers.push('the batch template is incomplete');

  for (const declared of policy.gate?.externalChecks ?? []) {
    const observed = externalChecks?.find((check) => check.title === declared.title);
    checks.push({ details: [declared.title], key: 'external', passed: !!observed?.passed });
  }
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

  if (policy.spec?.variantAxes?.length) {
    const gaps = uncoveredAxisValues(policy.spec.variantAxes, probeNodes.map(asBrief));
    checks.push({
      details: gaps.length ? gaps.map((gap) => `${gap.axis}=${gap.value}`) : undefined,
      key: 'axes_covered',
      passed: gaps.length === 0,
    });
    if (gaps.length) {
      blockers.push(`untested axes: ${gaps.map((gap) => `${gap.axis}=${gap.value}`).join(', ')}`);
    }
  }

  return {
    blockers,
    checks,
    met: blockers.length === 0,
    provisional: blockers.length === 0 && state.waveIndex === 0,
  };
};
