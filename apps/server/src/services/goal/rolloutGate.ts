import type {
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalRolloutGateCheck,
  GoalRolloutGateEvaluation,
  GoalRolloutPolicy,
  GoalRolloutState,
} from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';

import { uncoveredAxisValues } from './spec';

/** Node states that mean a unit will never produce again. */
const TERMINAL_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

export interface RolloutGateInput {
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

/** The gate's checks in one line, for the main Agent asked to release a wave. */
export const describeGateChecks = (gate?: Pick<RolloutGateResult, 'checks'>): string =>
  gate?.checks.length
    ? gate.checks
        .map(
          (check) =>
            `${check.key} ${check.passed ? 'passed' : 'failed'}${check.total === undefined ? '' : ` (${check.count ?? 0}/${check.total})`}`,
        )
        .join(', ')
    : 'no checks recorded';

/**
 * Whether a repeated batch has earned its next wave.
 *
 * Pure, so the judgment can be replayed and tested like the rest of
 * `decideNextMove`. Four conditions, all of which must hold:
 *
 * 1. every probe settled without a person (no rejected / retired probe);
 * 2. no human decision is open anywhere in the batch;
 * 3. the Template is complete enough to apply (a recipe outline exists);
 * 4. every declared variant axis value is represented among the probes (R4).
 *
 * An external anchor (real CI, a real remote merge) is not judged here yet:
 * nothing evaluates such a check, and a declared one could only ever block.
 */
export const evaluateRolloutGate = ({
  graph,
  policy,
  state,
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

/**
 * How many gate verdicts each round keeps. Per round, not overall: a busy later
 * round must never push an earlier round's latest verdict out of the record.
 */
export const GATE_LOG_PER_ROUND = 10;

/** Append one gate verdict to the batch's own record of them. */
export const withGateVerdict = (
  state: GoalRolloutState,
  entry: Omit<GoalRolloutGateEvaluation, 'at' | 'seq'>,
): GoalRolloutState => {
  const log = state.gateLog ?? [];
  // The round's latest verdict is always kept, so its ordinal continues from it.
  const previous = log.findLast((item) => item.revision === entry.revision);
  const seq = (previous?.seq ?? log.filter((item) => item.revision === entry.revision).length) + 1;
  const appended = [...log, { ...entry, at: new Date().toISOString(), seq }];
  const kept = new Map<number, number>();
  const gateLog = appended
    .toReversed()
    .filter((item) => {
      const count = kept.get(item.revision) ?? 0;
      kept.set(item.revision, count + 1);
      return count < GATE_LOG_PER_ROUND;
    })
    .toReversed();
  return { ...state, gateLog };
};
