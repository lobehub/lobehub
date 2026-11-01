import {
  GOAL_BATCH_ASSAY_TITLE,
  GOAL_BATCH_RELEASE_TITLE,
  GOAL_BATCH_TEMPLATE_TITLE,
  ROLLOUT_WAVE_SIZE_DEFAULT,
} from '@lobechat/const/goal';
import type {
  GoalRolloutGateCheck,
  GoalRolloutGateCheckKey,
  GoalRolloutGateEvaluation,
  GoalRolloutLearning,
  GoalRolloutPhase,
  GoalRolloutPlanSkill,
  GoalRolloutRetro,
  GoalRolloutVerifier,
} from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';

import { type GoalGraphView, type GoalNodeView, isRunningNode } from '../goalGraphViewModel';

/**
 * Read model for one expanded `batch` container (STAMP).
 *
 * The coordinator stores a batch as plain graph nodes — Templates, Assays and
 * unit tasks inside one container — plus `rolloutState` on the goal. A flat
 * layout of those nodes reads as N sibling cards, which is exactly the fan-out
 * a batch exists to avoid. This model regroups them into what the person
 * actually follows: the first round's probes, the recipe and its gate, the
 * roster as waves of squares, and one column per re-opened round (v2, v3…).
 */

/** One square's state: not run / running / needs a person / done / superseded. */
export type BatchCellState = 'backlog' | 'running' | 'human' | 'done' | 'stale';

export interface BatchCell {
  /** 0-based position inside its wave. */
  index: number;
  /** The node that delivers this unit on the main roster, once released. */
  nodeId?: string;
  /** The later round the unit was re-opened in (its square here is superseded). */
  reopenedIn?: number;
  /** A unit a later round first released: it never ran here, it runs there. */
  runIn?: number;
  state: BatchCellState;
  title: string;
  /** 0-based wave. */
  wave: number;
}

/** Where a re-opened unit came from, for the "re-opened from …" label. */
export type BatchUnitOrigin =
  | { kind: 'probe'; index: number }
  | { kind: 'round'; revision: number }
  | { index: number; kind: 'wave'; wave: number };

export interface BatchProbe {
  /** Which run of the unit this is, when it was sent back and run again in the round (2, 3…). */
  attempt?: number;
  from?: BatchUnitOrigin;
  nodeId: string;
  /** Every run of a unit sent back inside its round, first to latest — this one last. */
  runs?: { nodeId: string; state: BatchCellState }[];
  state: BatchCellState;
  title: string;
}

/** `locked` until its probes settle, `checking` once they did, `rejected` when a person sent it back. */
export type BatchGateState = 'locked' | 'checking' | 'passed' | 'human' | 'rejected';

/**
 * A gate verdict, plus which roster wave a release put out. The coordinator's
 * `waveIndex` restarts with each round; the roster's waves do not, and every
 * release puts out exactly the next one — so the wave is the release's ordinal.
 */
export interface BatchGateVerdict extends GoalRolloutGateEvaluation {
  wave?: number;
}

export interface BatchRound {
  assayId?: string;
  /** This round's gate verdicts, oldest first — what the gate actually judged. */
  evaluations: BatchGateVerdict[];
  /** Answered as "a new class", not as a revision of the previous recipe. */
  forked: boolean;
  gate: BatchGateState;
  /** Which group the break that opened this round surfaced in (rounds ≥ 2). */
  origin?:
    | { kind: 'probes' }
    | { kind: 'round'; revision: number }
    /** `wave`: the 0-based roster wave the re-opened units ran in. */
    | { kind: 'waves'; wave: number };
  /** The plan skill version this round runs on; a rewritten plan moves it past `revision`. */
  planVersion: number;
  probes: BatchProbe[];
  /** The release this round's passed gate is holding for a person, while it waits. */
  releaseId?: string;
  /** 1-based recipe revision. */
  revision: number;
  templateId?: string;
}

/**
 * One condition the release gate will check, before any verdict exists —
 * mirroring the coordinator's `evaluateRolloutGate`: the same keys in the same
 * order, and axis coverage when declared.
 */
export interface BatchGateCheck {
  key: GoalRolloutGateCheckKey;
}

export interface BatchModel {
  batchId: string;
  /** Other decisions inside the batch — e.g. a machine gate on one unit. */
  decisionIds: string[];
  /** What the gate checks, for a round no verdict has reached yet. */
  gateChecks: BatchGateCheck[];
  /** What the batch's breaks taught it, oldest first. */
  learnings: GoalRolloutLearning[];
  phase?: GoalRolloutPhase;
  /** The execution plan as a skill in the user's library; round N is its version N. */
  planSkill?: GoalRolloutPlanSkill;
  /** The retro after each execution: index 0 reads the probes, N reads roster wave N. */
  retros: GoalRolloutRetro[];
  rounds: BatchRound[];
  /** What every unit is judged on, once a retro produced it. */
  verifier?: GoalRolloutVerifier;
  /**
   * The round (1-based revision) each wave belongs to. A released wave belongs
   * to the plan it went out under; the waves not yet released belong to the
   * latest round — so after v2 opens, the rest of the roster moves under v2.
   */
  waveRounds: number[];
  /** The roster outside the first round's probes, chunked into waves. */
  waves: BatchCell[][];
  waveSize: number;
}

const byCreatedAt = (a: GoalNodeView, b: GoalNodeView) =>
  new Date(a.node.createdAt).getTime() - new Date(b.node.createdAt).getTime();

export const batchCellState = (
  view: GoalNodeView | undefined,
  waitingOn: ReadonlySet<string>,
): BatchCellState => {
  if (!view) return 'backlog';
  const { status } = view.node;
  // Retired is superseded; rejected is a unit that broke and waits on a person.
  if (status === 'retired') return 'stale';
  if (status === 'rejected') return 'human';
  if (status === 'resolved') return 'done';
  if (status === 'waiting' || view.decision || view.isStale || waitingOn.has(view.node.id))
    return 'human';
  // Held for a usage window to reopen: still in flight, resumes on its own.
  if (isRunningNode(view) || view.quotaRetryAt) return 'running';
  return 'backlog';
};

export const buildBatchModel = (graph: GoalGraphView, batchId: string): BatchModel => {
  const shape = { edges: graph.edges, nodes: graph.nodes.map((view) => view.node) };
  const memberIds = experimentMembers(shape, batchId, false);
  const members = graph.nodes.filter((view) => memberIds.has(view.node.id)).sort(byCreatedAt);
  const config = graph.goal.config;
  const state = config?.rolloutState?.batchNodeId === batchId ? config.rolloutState : undefined;
  const waveSize = Math.max(1, config?.rollout?.waveSize ?? ROLLOUT_WAVE_SIZE_DEFAULT);

  // A unit waits on a person when an open decision names it as its subject.
  const waitingOn = new Set(
    graph.nodes
      .filter((view) => view.node.kind === 'decision' && view.node.status === 'waiting')
      .map((view) => view.gateSubjectId)
      .filter((id): id is string => !!id),
  );
  // A unit that failed its own check held the batch (R6): its node can still
  // read active, but the batch is waiting on a person because of it.
  const held = state?.phase === 'pattern_break' ? state.gateLog?.at(-1) : undefined;
  if (held?.trigger === 'unit' && held.nodeId) waitingOn.add(held.nodeId);
  // A unit a later round re-opened (`derived_from` it) is superseded, whatever
  // state it ended in — a rejected trial must not read "needs you" forever.
  const superseded = new Set(
    graph.edges.filter((edge) => edge.kind === 'derived_from').map((edge) => edge.targetNodeId),
  );
  const cellOf = (id?: string): BatchCellState =>
    id && superseded.has(id) ? 'stale' : batchCellState(id ? graph.byId[id] : undefined, waitingOn);

  const templates = members.filter(
    (view) => view.node.kind === 'finding' && view.node.title === GOAL_BATCH_TEMPLATE_TITLE,
  );
  const assays = members.filter(
    (view) => view.node.kind === 'decision' && view.node.title === GOAL_BATCH_ASSAY_TITLE,
  );
  const tasks = members.filter((view) => view.node.kind === 'task');

  // Each Assay gates exactly the probes of its own round.
  const gatedBy = (assayId: string) =>
    graph.edges
      .filter((edge) => edge.kind === 'depends_on' && edge.sourceNodeId === assayId)
      .map((edge) => edge.targetNodeId)
      .filter((id) => memberIds.has(id));
  // Each held release is a decision node of its own; only an open one belongs
  // on the gate, the answered ones are its history.
  const releaseReviews = members.filter(
    (view) => view.node.kind === 'decision' && view.node.title === GOAL_BATCH_RELEASE_TITLE,
  );
  const openRelease = releaseReviews.find((view) => view.node.status === 'waiting');
  // A round whose held release the owner sent back ended rejected, though its
  // Assay itself was never answered: the decision lives on the release node,
  // opened between this round's Assay and the next one.
  const sentBack = (assay?: GoalNodeView, nextAssay?: GoalNodeView) =>
    !!assay &&
    releaseReviews.some(
      (view) =>
        byCreatedAt(view, assay) >= 0 &&
        (!nextAssay || byCreatedAt(view, nextAssay) < 0) &&
        view.humanTouches.some((touch) => touch.resolvedOptionId === 'revise'),
    );
  const roundCount = Math.max(templates.length, assays.length, 1);
  const probeIdsByRound = Array.from({ length: roundCount }, (_, r) => {
    const assay = assays[r];
    if (assay) return gatedBy(assay.node.id);
    return r === roundCount - 1 && assays.length > 0 ? (state?.probeNodeIds ?? []) : [];
  });
  const roundOfProbe = new Map<string, number>();
  probeIdsByRound.forEach((ids, r) => ids.forEach((id) => roundOfProbe.set(id, r)));

  // The roster in delivery order; the first round's probes run as cards, the
  // rest of the roster is what the waves deliver.
  const firstProbeTitles = new Set(
    probeIdsByRound[0].map((id) => graph.byId[id]?.node.title).filter(Boolean),
  );
  // History reads the full roster the batch was planned with: a restart re-cuts
  // `unitTitles` to what is still owed, which would drop the units already
  // delivered from the map. The state roster is the fallback for old batches.
  const roster =
    config?.rollout?.units ??
    state?.unitTitles ??
    tasks.filter((view) => !roundOfProbe.has(view.node.id)).map((view) => view.node.title);
  const pending = roster.filter((title) => !firstProbeTitles.has(title));

  const tasksByTitle = new Map<string, GoalNodeView[]>();
  for (const view of tasks)
    tasksByTitle.set(view.node.title, [...(tasksByTitle.get(view.node.title) ?? []), view]);

  const waves: BatchCell[][] = [];
  const waveOf = new Map<string, { index: number; wave: number }>();
  pending.forEach((title, position) => {
    const wave = Math.floor(position / waveSize);
    const index = position % waveSize;
    const nodes = tasksByTitle.get(title) ?? [];
    // The newest delivery on the main roster: a broken unit that did not fit in
    // the restarted canary is re-delivered by a later wave as a new task, and
    // the cell must follow that one, not the original that broke.
    const mainNodes = nodes.filter((view) => !roundOfProbe.has(view.node.id));
    const main = mainNodes.at(-1);
    // Every earlier slot still names where a re-opened unit first ran.
    for (const earlier of mainNodes.slice(0, -1)) waveOf.set(earlier.node.id, { index, wave });
    const later = nodes.find((view) => (roundOfProbe.get(view.node.id) ?? 0) > 0);
    const laterRound = later ? roundOfProbe.get(later.node.id)! + 1 : undefined;
    if (main) waveOf.set(main.node.id, { index, wave });
    (waves[wave] ??= []).push(
      main
        ? {
            index,
            nodeId: main.node.id,
            reopenedIn: laterRound,
            // Re-opened in a later round: what ran here is superseded.
            state: later ? 'stale' : cellOf(main.node.id),
            title,
            wave,
          }
        : {
            index,
            // Never released here: the square follows the round that runs it.
            nodeId: later?.node.id,
            runIn: laterRound,
            state: cellOf(later?.node.id),
            title,
            wave,
          },
    );
  });

  // A released unit went out under the latest plan at the time it was created.
  const roundAt = (view: GoalNodeView) => {
    let round = 1;
    templates.forEach((template, r) => {
      if (byCreatedAt(template, view) <= 0) round = r + 1;
    });
    return round;
  };
  const waveRounds = waves.map((wave) => {
    const released = wave.find((cell) => cell.nodeId && !cell.runIn);
    if (released?.nodeId && graph.byId[released.nodeId])
      return roundAt(graph.byId[released.nodeId]);
    const runIn = wave.find((cell) => cell.runIn)?.runIn;
    return runIn ?? roundCount;
  });

  // Where a re-opened unit ran before: the most recent earlier node with its title.
  const originOf = (view: GoalNodeView): BatchUnitOrigin | undefined => {
    const earlier = (tasksByTitle.get(view.node.title) ?? []).filter(
      (other) => other !== view && byCreatedAt(other, view) < 0,
    );
    const previous = earlier.at(-1);
    if (!previous) return undefined;
    const round = roundOfProbe.get(previous.node.id);
    if (round === 0) return { index: probeIdsByRound[0].indexOf(previous.node.id), kind: 'probe' };
    // Re-opened again: follow it back to the batch it first ran in (第 3 批),
    // naming the round only when there is no batch to name.
    if (round !== undefined) return originOf(previous) ?? { kind: 'round', revision: round + 1 };
    const slot = waveOf.get(previous.node.id);
    return slot ? { ...slot, kind: 'wave' } : undefined;
  };

  // The coordinator writes each release's roster wave; a verdict from before it
  // did falls back to counting the releases kept in the log.
  let releases = 0;
  const verdicts: BatchGateVerdict[] = (state?.gateLog ?? []).map((entry) => {
    if (entry.outcome !== 'released') return entry;
    releases = entry.wave ?? releases + 1;
    return { ...entry, wave: releases };
  });

  const rounds: BatchRound[] = probeIdsByRound.map((ids, r) => {
    // A unit sent back and run again inside its round keeps one place there:
    // its latest run, numbered, instead of a superseded square beside it.
    const inRound = new Set(ids);
    const rerunOf = new Map(
      graph.edges
        .filter(
          (edge) =>
            edge.kind === 'derived_from' &&
            inRound.has(edge.sourceNodeId) &&
            inRound.has(edge.targetNodeId),
        )
        .map((edge) => [edge.sourceNodeId, edge.targetNodeId]),
    );
    const rerun = new Set(rerunOf.values());
    const attemptOf = (id: string): number => {
      const earlier = rerunOf.get(id);
      return earlier ? attemptOf(earlier) + 1 : 1;
    };
    // Where the unit first ran, so a re-run keeps its place among the trials.
    const firstRunOf = (id: string): string => {
      const earlier = rerunOf.get(id);
      return earlier ? firstRunOf(earlier) : id;
    };
    // The unit's runs in this round, first to latest.
    const runsOf = (id: string): string[] => {
      const earlier = rerunOf.get(id);
      return earlier ? [...runsOf(earlier), id] : [id];
    };
    const probes = ids
      .filter((id) => !rerun.has(id))
      .map((id) => graph.byId[id])
      .filter((view): view is GoalNodeView => !!view)
      .sort(
        (a, b) =>
          byCreatedAt(
            graph.byId[firstRunOf(a.node.id)] ?? a,
            graph.byId[firstRunOf(b.node.id)] ?? b,
          ) || byCreatedAt(a, b),
      )
      .map((view) => {
        const attempt = attemptOf(view.node.id);
        return {
          ...(attempt > 1 && {
            attempt,
            // A superseded run is history here, read as it ended, not as superseded.
            runs: runsOf(view.node.id).map((id) => ({
              nodeId: id,
              state: batchCellState(graph.byId[id], waitingOn),
            })),
          }),
          from: r > 0 ? originOf(view) : undefined,
          nodeId: view.node.id,
          state: cellOf(view.node.id),
          title: view.node.title,
        };
      });
    const template = templates[r];
    const assay = assays[r];
    const previousTemplate = templates[r - 1];
    const forked =
      r > 0 &&
      !!template &&
      !!previousTemplate &&
      !graph.edges.some(
        (edge) =>
          edge.kind === 'revises' &&
          edge.sourceNodeId === template.node.id &&
          edge.targetNodeId === previousTemplate.node.id,
      );
    return {
      assayId: assay?.node.id,
      evaluations: verdicts.filter((entry) => entry.revision === r + 1),
      forked,
      gate:
        r === roundCount - 1 && openRelease
          ? 'human'
          : r < roundCount - 1 && sentBack(assay, assays[r + 1])
            ? 'rejected'
            : gateState(assay, r === roundCount - 1, state?.phase, probes),
      origin: r > 0 ? roundOrigin(probes, r) : undefined,
      planVersion: state?.planVersions?.[String(r + 1)] ?? r + 1,
      probes,
      releaseId: r === roundCount - 1 ? openRelease?.node.id : undefined,
      revision: r + 1,
      templateId: template?.node.id,
    };
  });

  const assayIds = new Set([...assays, ...releaseReviews].map((view) => view.node.id));
  const decisionIds = members
    .filter((view) => view.node.kind === 'decision' && !assayIds.has(view.node.id))
    .map((view) => view.node.id);

  const policy = config?.rollout;
  const gateChecks: BatchGateCheck[] = [
    { key: 'units_settled' },
    { key: 'units_succeeded' },
    { key: 'no_open_decision' },
    { key: 'plan_written' },
    ...(policy?.spec?.variantAxes?.length ? [{ key: 'axes_covered' as const }] : []),
    // A batch that runs retros opens its gate on them: re-verified, every intervention accounted.
    ...(state?.retros?.length
      ? [{ key: 'reverified' as const }, { key: 'interventions_accounted' as const }]
      : []),
  ];

  return {
    batchId,
    decisionIds,
    gateChecks,
    learnings: state?.learnings ?? [],
    phase: state?.phase,
    planSkill: state?.planSkill,
    retros: state?.retros ?? [],
    rounds,
    verifier: state?.verifier,
    waveRounds,
    waves,
    waveSize,
  };
};

const gateState = (
  assay: GoalNodeView | undefined,
  current: boolean,
  phase: GoalRolloutPhase | undefined,
  probes: BatchProbe[],
): BatchGateState => {
  if (assay && (assay.decision || assay.node.status === 'waiting')) return 'human';
  if (!current) return assay?.humanTouches.length ? 'rejected' : 'passed';
  if (phase === 'mass' || phase === 'done') return 'passed';
  if (phase === 'pattern_break' || phase === 'release_review') return 'human';
  const settled = probes.length > 0 && probes.every((probe) => probe.state === 'done');
  return settled ? 'checking' : 'locked';
};

/** A round re-opens units from where they broke; the first one names the source. */
const roundOrigin = (probes: BatchProbe[], r: number): BatchRound['origin'] => {
  const from = probes.find((probe) => probe.from)?.from;
  if (from?.kind === 'wave') return { kind: 'waves', wave: from.wave };
  if (from?.kind === 'round') return { kind: 'round', revision: from.revision };
  if (from?.kind === 'probe' || r === 1) return { kind: 'probes' };
  return { kind: 'round', revision: r };
};

export const countCells = (cells: { state: BatchCellState }[]) => {
  const counts: Record<BatchCellState, number> = {
    backlog: 0,
    done: 0,
    human: 0,
    running: 0,
    stale: 0,
  };
  for (const cell of cells) counts[cell.state] += 1;
  return counts;
};

/**
 * The batch and round a release gate belongs to, when `nodeId` is one — so a
 * surface that opens the gate can show its verdicts rather than a bare decision.
 */
export const findBatchGate = (
  graph: GoalGraphView,
  nodeId: string,
): { model: BatchModel; round: BatchRound } | undefined => {
  const batchId = graph.edges.find(
    (edge) =>
      edge.kind === 'contains' &&
      edge.targetNodeId === nodeId &&
      graph.byId[edge.sourceNodeId]?.node.kind === 'batch',
  )?.sourceNodeId;
  if (!batchId) return undefined;
  const model = buildBatchModel(graph, batchId);
  const round = model.rounds.find((item) => item.assayId === nodeId);
  return round ? { model, round } : undefined;
};

/**
 * The checks a verdict stands on. A unit that failed its own check (R6) held
 * the batch without the gate running, so it records none — it reads as the one
 * check it broke, naming the unit.
 */
export const verdictChecks = (evaluation: GoalRolloutGateEvaluation): GoalRolloutGateCheck[] =>
  evaluation.trigger === 'unit'
    ? [
        {
          key: 'units_succeeded',
          nodeIds: evaluation.nodeId ? [evaluation.nodeId] : undefined,
          passed: false,
        },
      ]
    : evaluation.checks;

/**
 * A round's re-opened units as rows, grouped by where they came from — so each
 * row can say which batch it is (第 3 批) — and capped at the wave size.
 */
export const reopenedRows = (
  probes: BatchProbe[],
  waveSize: number,
): { from?: BatchUnitOrigin; probes: BatchProbe[] }[] => {
  const groups = new Map<string, BatchProbe[]>();
  for (const probe of probes) {
    const from = probe.from;
    const key =
      from?.kind === 'wave'
        ? `wave:${from.wave}`
        : from?.kind === 'round'
          ? `round:${from.revision}`
          : (from?.kind ?? 'none');
    groups.set(key, [...(groups.get(key) ?? []), probe]);
  }
  return [...groups.values()].flatMap((group) =>
    Array.from({ length: Math.ceil(group.length / waveSize) }, (_, i) => ({
      from: group[0].from,
      probes: group.slice(i * waveSize, (i + 1) * waveSize),
    })),
  );
};

/**
 * The batch and round a plan version belongs to, when `nodeId` is one — so the
 * panel that opens on it can show every version and what changed between them.
 */
/** How a round's plan is named: a skill when the batch keeps its plan as one. */
export const batchPlanTitleKey = (model: Pick<BatchModel, 'planSkill'>, round: BatchRound) =>
  model.planSkill
    ? round.forked
      ? ('goalBatch.skill.forked' as const)
      : ('goalBatch.skill.title' as const)
    : round.forked
      ? ('goalBatch.template.forked' as const)
      : ('goalBatch.template.title' as const);

export const findBatchPlan = (
  graph: GoalGraphView,
  nodeId: string,
): { model: BatchModel; round: BatchRound } | undefined => {
  const batchId = graph.edges.find(
    (edge) =>
      edge.kind === 'contains' &&
      edge.targetNodeId === nodeId &&
      graph.byId[edge.sourceNodeId]?.node.kind === 'batch',
  )?.sourceNodeId;
  if (!batchId) return undefined;
  const model = buildBatchModel(graph, batchId);
  const round = model.rounds.find((item) => item.templateId === nodeId);
  return round ? { model, round } : undefined;
};

/**
 * The retro a round starts from, drawn at the top of its frame: the cold
 * start's for the first round, and for a later one the retro of the wave whose
 * break opened it.
 */
export const roundRetro = (model: Pick<BatchModel, 'retros'>, revision: number) =>
  model.retros.find((retro) => (revision === 1 ? retro.wave === 0 : retro.opens === revision));
