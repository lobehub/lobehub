import type { GoalGraphSnapshot, GoalObjective } from '@lobechat/types';
import { experimentOwner } from '@lobechat/utils/goalGraph';
import { isBetterScore } from '@lobechat/utils/goalObjective';

import { GoalGraphModel } from '@/database/models/goalGraph';
import { MetricModel } from '@/database/models/metric';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

export const DEFAULT_OBJECTIVE_KEY = 'objective';
export const DEFAULT_EVALUATION_TIMEOUT_SECONDS = 1800;
/** Points a leaderboard reads; far beyond what a goal's lanes submit in a day. */
const LEADERBOARD_POINTS = 5000;
/** The lane of an evaluation recorded by a person rather than a Task run. */
export const MANUAL_LANE = 'manual';

export const objectiveKey = (objective: Pick<GoalObjective, 'key'>) =>
  objective.key?.trim() || DEFAULT_OBJECTIVE_KEY;

/** What one evaluation stores beside its score (metric point `metadata`). */
export interface EvaluationMetadata {
  durationMs?: number;
  /** Hash of the graded working tree, when the evaluator could compute one. */
  fingerprint?: string;
  lane: string;
  metrics?: Record<string, number>;
  summary?: string;
  taskId?: string;
  taskNodeId?: string;
}

export interface ObjectiveLane {
  best: number;
  bestAt: string;
  evaluations: number;
  /** The fingerprint of the latest evaluation, to tell lanes shipping identical work. */
  fingerprint?: string;
  lane: string;
  latest: number;
  latestAt: string;
  title: string;
}

export interface GoalLeaderboard {
  best?: number;
  /** When the overall best was first reached. */
  bestAt?: string;
  key: string;
  /** Best first, in the objective's direction. */
  lanes: ObjectiveLane[];
  leader?: string;
  objective: GoalObjective;
  /** The reader's own lane, when a Task run asked. */
  you?: string;
}

interface ObjectivePoint {
  metadata: unknown;
  observedAt: Date | string;
  value: number;
}

const iso = (at: Date | string) => new Date(at).toISOString();

/**
 * The leaderboard of an objective series: each lane's best and latest score,
 * best lane first. Points without a lane count as {@link MANUAL_LANE}.
 */
export const buildLeaderboard = (
  objective: GoalObjective,
  points: readonly ObjectivePoint[],
  titleOf: (lane: string) => string = (lane) => lane,
): GoalLeaderboard => {
  const lanes = new Map<string, ObjectiveLane>();
  const ordered = [...points].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );
  let best: number | undefined;
  let bestAt: string | undefined;
  for (const point of ordered) {
    const meta = (point.metadata ?? {}) as Partial<EvaluationMetadata>;
    const lane = meta.lane || MANUAL_LANE;
    const at = iso(point.observedAt);
    const current = lanes.get(lane);
    if (!current) {
      lanes.set(lane, {
        best: point.value,
        bestAt: at,
        evaluations: 1,
        fingerprint: meta.fingerprint,
        lane,
        latest: point.value,
        latestAt: at,
        title: titleOf(lane),
      });
    } else {
      current.evaluations += 1;
      current.latest = point.value;
      current.latestAt = at;
      current.fingerprint = meta.fingerprint;
      if (isBetterScore(objective.direction, point.value, current.best)) {
        current.best = point.value;
        current.bestAt = at;
      }
    }
    if (best === undefined || isBetterScore(objective.direction, point.value, best)) {
      best = point.value;
      bestAt = at;
    }
  }
  const ranked = [...lanes.values()].sort((a, b) =>
    a.best === b.best
      ? a.bestAt.localeCompare(b.bestAt)
      : isBetterScore(objective.direction, a.best, b.best)
        ? -1
        : 1,
  );
  return {
    best,
    bestAt,
    key: objectiveKey(objective),
    lanes: ranked,
    leader: ranked[0]?.lane,
    objective,
  };
};

/** A Task's lane: its experiment container, or the Task node itself outside one. */
export const laneOf = (graph: Pick<GoalGraphSnapshot, 'edges' | 'nodes'>, nodeId: string) =>
  experimentOwner(graph, nodeId) ?? nodeId;

export class GoalObjectiveError extends Error {
  constructor(
    message: string,
    readonly code: 'BAD_REQUEST' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'GoalObjectiveError';
  }
}

export interface RecordEvaluationInput {
  durationMs?: number;
  fingerprint?: string;
  metrics?: Record<string, number>;
  score: number;
  summary?: string;
  valid: boolean;
}

/** The Goal Task run an evaluation comes from (see `GoalMarkModel.findRunNode`). */
export interface EvaluationRun {
  agentId?: string;
  nodeId: string;
  operationId?: string;
  taskId: string;
}

/**
 * Set, read and feed a goal's objective.
 *
 * Scores live in the generic metric layer (subject = the goal), so the
 * north-star views read them like any other measurement; the lane rides in
 * each point's metadata and the leaderboard is derived from the series.
 */
export class GoalObjectiveService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private requireGraph = async (goalId: string) => {
    const graph = await new GoalGraphModel(this.db, this.userId, this.workspaceId).getGraph(goalId);
    if (!graph) throw new GoalObjectiveError('Goal not found', 'NOT_FOUND');
    return graph;
  };

  private titleOf = (graph: GoalGraphSnapshot) => (lane: string) =>
    graph.nodes.find((node) => node.id === lane)?.title ?? lane;

  /** Set the objective, or clear it with `null`. */
  setObjective = async (goalId: string, objective: GoalObjective | null) => {
    if (objective) {
      if (!objective.evaluator.trim())
        throw new GoalObjectiveError('The objective needs an evaluator command', 'BAD_REQUEST');
      if (objective.direction !== 'max' && objective.direction !== 'min')
        throw new GoalObjectiveError('Direction must be max or min', 'BAD_REQUEST');
    }
    await this.db.transaction(async (tx) => {
      const model = new GoalRepository(tx, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (!goal) throw new GoalObjectiveError('Goal not found', 'NOT_FOUND');
      const { objective: _previous, ...config } = goal.config ?? {};
      await model.update(goalId, {
        config: objective
          ? { ...config, objective: { ...objective, evaluator: objective.evaluator.trim() } }
          : config,
      });
    });
    return objective;
  };

  /**
   * The objective and its leaderboard; undefined when the goal has no
   * objective. `nodeId` is a reading run's Task node, to name its lane.
   */
  leaderboard = async (goalId: string, nodeId?: string): Promise<GoalLeaderboard | undefined> => {
    const graph = await this.requireGraph(goalId);
    const board = await this.leaderboardOf(graph);
    return board && nodeId ? { ...board, you: laneOf(graph, nodeId) } : board;
  };

  private leaderboardOf = async (graph: GoalGraphSnapshot) => {
    const objective = graph.goal.config?.objective;
    if (!objective) return undefined;
    const metrics = new MetricModel(this.db, this.userId, this.workspaceId);
    const series = await metrics.findByKey('goal', graph.goal.id, objectiveKey(objective));
    const points = series ? await metrics.recentPoints(series.id, LEADERBOARD_POINTS) : [];
    return buildLeaderboard(objective, points, this.titleOf(graph));
  };

  /**
   * Record one evaluation. A valid one becomes a point of the objective series
   * in the run's lane — its experiment container, or its Task node when it has
   * none; an invalid one is reported back but not charted, because the series
   * holds scores and an unrankable result has none.
   */
  recordEvaluation = async (goalId: string, input: RecordEvaluationInput, run?: EvaluationRun) => {
    if (!Number.isFinite(input.score))
      throw new GoalObjectiveError('The score must be a finite number', 'BAD_REQUEST');
    const graph = await this.requireGraph(goalId);
    const objective = graph.goal.config?.objective;
    if (!objective)
      throw new GoalObjectiveError(
        'This goal has no objective; set one with `lh goal set-objective`',
        'BAD_REQUEST',
      );
    const lane = run ? laneOf(graph, run.nodeId) : MANUAL_LANE;
    const before = await this.leaderboardOf(graph);
    if (!input.valid) return { lane, leaderboard: before, recorded: false as const };

    const metrics = new MetricModel(this.db, this.userId, this.workspaceId);
    const series = await metrics.ensure({
      key: objectiveKey(objective),
      kind: 'gauge',
      subjectId: goalId,
      subjectType: 'goal',
      title: objective.title,
    });
    if (!series)
      throw new GoalObjectiveError('Objective series is owned by another scope', 'BAD_REQUEST');
    const metadata: EvaluationMetadata = {
      durationMs: input.durationMs,
      fingerprint: input.fingerprint,
      lane,
      metrics: input.metrics,
      summary: input.summary?.slice(0, 2000),
      taskId: run?.taskId,
      taskNodeId: run?.nodeId,
    };
    await metrics.addPoint(series.id, {
      actorId: run?.agentId ?? this.userId,
      actorType: run?.agentId ? 'agent' : 'user',
      metadata,
      observedAt: new Date(),
      operationId: run?.operationId,
      sourceType: run ? 'probe' : 'manual',
      value: input.score,
    });
    const leaderboard = (await this.leaderboardOf(graph))!;
    const laneBefore = before?.lanes.find((item) => item.lane === lane)?.best;
    return {
      lane,
      leaderboard,
      newBest:
        before?.best === undefined || isBetterScore(objective.direction, input.score, before.best),
      newLaneBest:
        laneBefore === undefined || isBetterScore(objective.direction, input.score, laneBefore),
      recorded: true as const,
    };
  };
}
