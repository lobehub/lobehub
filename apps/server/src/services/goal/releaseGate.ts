import type {
  GoalGraphSnapshot,
  GoalReleaseGateDossier,
  GoalReleaseGateUnit,
  VerifyCheckItem,
} from '@lobechat/types';
import debug from 'debug';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyReportModel } from '@/database/models/verifyReport';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from '../verify/acceptanceService';
import type { RolloutGateResult } from './rolloutGate';

const log = debug('lobe-server:goal-release-gate');

/** Goal graph as `GoalService.graph()` returns it: the snapshot plus spend and acceptances. */
type FetchedGraph = GoalGraphSnapshot;

const PLAN_ITEM_ID = 'plan';
const NEXT_WAVE_ITEM_ID = 'next-wave';
const GATE_CHECKS_ITEM_ID = 'gate-checks';
const unitItemId = (nodeId: string) => `unit:${nodeId}`;

/**
 * Build the dossier a release gate is decided on, from the fetched graph.
 *
 * Probes on the first move to batch execution; the last released wave when a
 * later release is held. Frozen into the gate's round, so the review page and
 * any later audit read what the owner actually saw.
 */
export const buildReleaseGateDossier = (
  graph: FetchedGraph,
  input: {
    diagnosis?: string;
    gate?: Pick<RolloutGateResult, 'checks'>;
    kind: GoalReleaseGateDossier['kind'];
    waveSize: number;
  },
): GoalReleaseGateDossier | undefined => {
  const policy = graph.goal.config?.rollout;
  const state = graph.goal.config?.rolloutState;
  if (!policy || !state) return;

  const lastRelease = state.gateLog?.findLast((entry) => entry.outcome === 'released');
  const unitIds =
    state.waveIndex === 0
      ? state.probeNodeIds
      : (state.massNodeIds ?? []).slice(-(lastRelease?.releasedCount ?? input.waveSize));
  const spendByTask = new Map((graph.spend?.byTask ?? []).map((row) => [row.taskId, row]));

  const units: GoalReleaseGateUnit[] = unitIds.flatMap((nodeId) => {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return [];
    const spend = node.taskId ? spendByTask.get(node.taskId) : undefined;
    const acceptance = graph.acceptances?.[nodeId];
    return [
      {
        ...(acceptance && {
          acceptance: {
            id: acceptance.id,
            ...(acceptance.checks && {
              checks: {
                failed: acceptance.checks.failed,
                passed: acceptance.checks.passed,
                total: acceptance.checks.total,
              },
            }),
          },
        }),
        artifacts: graph.workVersions
          .filter((link) => link.nodeId === nodeId && link.work && link.work.type !== 'task')
          .map((link) => ({
            ...(link.work!.type === 'document' &&
              link.work!.resourceId && { documentId: link.work!.resourceId }),
            title: link.work!.title ?? link.work!.identifier ?? '',
            type: link.work!.type,
            ...(link.work!.url && { url: link.work!.url }),
          })),
        ...(node.description && { brief: node.description }),
        nodeId,
        runs: spend?.runs ?? 0,
        status: node.status,
        ...(node.taskId && { taskId: node.taskId }),
        title: node.title,
        tokens: spend?.totalTokens ?? 0,
      },
    ];
  });

  const roster = state.unitTitles ?? [];
  const released = state.releasedCount ?? state.probeNodeIds.length;
  const nextWave = roster.slice(released, released + input.waveSize).map((title) => ({
    ...(policy.unitBriefs?.[title] && { brief: policy.unitBriefs[title] }),
    title,
  }));

  return {
    ...(graph.goal.agentId && { agentId: graph.goal.agentId }),
    checks: input.gate?.checks ?? state.gateLog?.at(-1)?.checks ?? [],
    ...(input.diagnosis && { diagnosis: input.diagnosis }),
    goalId: graph.goal.id,
    goalTitle: graph.goal.title,
    kind: input.kind,
    nextWave,
    plan: {
      content: policy.spec?.recipeOutline ?? '',
      revision: state.planVersions?.[String(state.templateRevision)] ?? state.templateRevision,
      ...(state.planSkill && { skillId: state.planSkill.id, skillName: state.planSkill.name }),
    },
    remainingAfter: Math.max(0, roster.length - released - nextWave.length),
    units,
    wave: (state.wavesReleased ?? state.waveIndex) + 1,
  };
};

/** One checklist item per thing the owner judges, so comments can anchor to it. */
const gatePlan = (dossier: GoalReleaseGateDossier): VerifyCheckItem[] => {
  const item = (id: string, title: string, category: string, index: number): VerifyCheckItem => ({
    category,
    id,
    index,
    onFail: 'manual',
    required: true,
    title,
    verifierConfig: {},
    verifierType: 'program',
  });
  return [
    item(PLAN_ITEM_ID, `Plan v${dossier.plan.revision} fits every unit still owed`, 'Plan', 0),
    ...dossier.units.map((unit, index) =>
      item(unitItemId(unit.nodeId), unit.title, 'Results', index + 1),
    ),
    item(
      NEXT_WAVE_ITEM_ID,
      `Wave ${dossier.wave} (${dossier.nextWave.length} units) can start`,
      'After release',
      dossier.units.length + 1,
    ),
    item(GATE_CHECKS_ITEM_ID, 'Gate checks', 'Gate', dossier.units.length + 2),
  ];
};

/**
 * Open the acceptance a held release is reviewed on: one aggregate per gate
 * node, one round carrying the frozen dossier, settled at once so the owner
 * can decide on it. Best-effort for the caller — a gate that could not get its
 * review page still holds the goal and stays answerable on the goal page.
 */
export const openReleaseGateAcceptance = async (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  gateNodeId: string,
  dossier: GoalReleaseGateDossier,
  /** The review a rewritten plan returns to; a first review opens its own. */
  existingAcceptanceId?: string,
): Promise<string> => {
  const service = new AcceptanceService(db, scope.userId, scope.workspaceId);
  const requirement =
    dossier.kind === 'probes'
      ? `Decide whether "${dossier.goalTitle}" moves from its experiments to batch execution`
      : `Decide whether "${dossier.goalTitle}" releases wave ${dossier.wave}`;
  const existing = existingAcceptanceId
    ? await service.acceptanceModel.findById(existingAcceptanceId)
    : undefined;
  const acceptance =
    existing ?? (await service.ensureForSubject('goal_gate', gateNodeId, { requirement }));
  if (!existing)
    await service.acceptanceModel.patchMetadata(acceptance.id, { title: dossier.goalTitle });

  const plan = gatePlan(dossier);
  const run = await new VerifyRunModel(db, scope.userId, scope.workspaceId).create({
    goal: requirement,
    metadata: { releaseGate: dossier },
    plan,
    scenario: 'generic',
    source: 'agent',
    title: requirement,
  });
  await service.attachRun(run.id, acceptance.id);

  const results = new VerifyCheckResultModel(db, scope.userId, scope.workspaceId);
  const reworked = (runs: number) => runs > 1;
  for (const item of plan) {
    const unit = dossier.units.find((candidate) => unitItemId(candidate.nodeId) === item.id);
    const gateFailed = item.id === GATE_CHECKS_ITEM_ID && dossier.checks.some((c) => !c.passed);
    // A reworked unit or an unsettled check is what the owner has to look at:
    // `uncertain`, so the review lists it as an exception rather than a pass.
    const verdict =
      (unit && (reworked(unit.runs) || unit.status !== 'resolved')) || gateFailed
        ? ('uncertain' as const)
        : ('passed' as const);
    await results.upsertByCheckItem({
      checkItemId: item.id,
      checkItemIndex: item.index,
      checkItemTitle: item.title,
      completedAt: new Date(),
      required: true,
      status: 'passed',
      verdict,
      verifierType: 'program',
      verifyRunId: run.id,
    });
  }

  await new VerifyReportModel(db, scope.userId, scope.workspaceId).upsertByRun({
    content: null,
    failedChecks: 0,
    generatedBy: 'goal-coordinator',
    overallConfidence: null,
    passedChecks: plan.length,
    summary: requirement,
    totalChecks: plan.length,
    uncertainChecks: null,
    verdict: 'passed',
    verifyRunId: run.id,
  });
  await service.recomputeStatus(acceptance.id);
  log('release gate %s → acceptance %s (round run %s)', gateNodeId, acceptance.id, run.id);
  return acceptance.id;
};
