import type { TaskItem } from '@lobechat/types';

import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';

export type SubtaskRunnableStatus = 'backlog' | 'paused' | 'failed';

const RUNNABLE_STATUSES: ReadonlySet<string> = new Set<SubtaskRunnableStatus>([
  'backlog',
  'paused',
  'failed',
]);
/** Statuses that satisfy a `blocks` dependency — the upstream is "done enough". */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'canceled']);

/** Sentinel status used when an upstream task referenced by a dependency edge
 * cannot be located (deleted, hard-removed, etc.). Treated as a blocker so the
 * dependent doesn't get prematurely kicked off. */
const UNKNOWN_STATUS = '__unknown__';

export interface SubtaskGraphPlan {
  /** Tasks that already finished (completed / canceled) and are skipped. */
  alreadyDone: string[];
  alreadyDoneTasks?: { id: string; identifier: string }[];
  /** Tasks blocked by an unbroken cycle and therefore unreachable. */
  blockedByCycle: string[];
  blockedByCycleTasks?: { id: string; identifier: string }[];
  /**
   * Tasks waiting on a dependency we cannot satisfy in this batch — either an
   * in-flight task (running / scheduled / etc.) or a task outside this subtree.
   * They will be picked up later through the normal cascade once the blocker
   * completes; surfacing them here lets the UI explain why they're not in any
   * layer.
   */
  blockedExternally: string[];
  blockedExternallyTasks?: { id: string; identifier: string }[];
  /** Identifiers participating in at least one dependency cycle. */
  cycles: string[];
  cyclesTasks?: { id: string; identifier: string }[];
  /**
   * Descendants whose own state excludes them from this batch (running /
   * scheduled / archived / etc.). Distinct from `blockedExternally`, which describes a
   * runnable task held back by *some other* task.
   */
  ineligible: string[];
  ineligibleTasks?: { id: string; identifier: string }[];
  /** Topologically sorted layers of runnable tasks. Layer N waits on layer N-1. */
  layers: string[][];
  layerTasks?: { id: string; identifier: string }[][];
  /** Total runnable tasks across all layers. */
  totalRunnable: number;
}

export interface SubtaskNode {
  /** Archived by the user: never run, so it sits out like an ineligible status. */
  archived?: boolean;
  /** Tasks this one depends on (must be `completed` first). */
  dependsOn: string[];
  id: string;
  identifier: string;
  status: string;
}

/**
 * Group runnable subtasks into topological layers using Kahn's algorithm.
 *
 * Edge classification (per dependency):
 *   - upstream is `completed` / `canceled` → satisfied, edge dropped
 *   - upstream is runnable AND in this batch → tracked as in-batch edge
 *   - anything else (in-flight descendant, out-of-scope task, unknown) →
 *     treated as an *external blocker*. The dependent is excluded from layers
 *     and surfaced via `blockedExternally`. Crucially we never silently drop
 *     such an edge — that would let the dependent run before its blocker.
 *
 * `externalStatuses` lets the caller pass in statuses for upstream identifiers
 * that aren't represented in `nodes` (e.g. dependencies on tasks outside the
 * current subtree). Identifiers missing from both `nodes` and `externalStatuses`
 * are treated as unknown / blocking.
 */
export const planSubtaskLayers = (
  nodes: SubtaskNode[],
  externalStatuses: ReadonlyMap<string, string> = new Map(),
): SubtaskGraphPlan => {
  const alreadyDone: string[] = [];
  const ineligible: string[] = [];
  const runnableSet = new Set<string>();
  const statusById = new Map<string, string>();

  for (const node of nodes) {
    statusById.set(node.id, node.status);
    if (TERMINAL_STATUSES.has(node.status)) {
      alreadyDone.push(node.id);
    } else if (RUNNABLE_STATUSES.has(node.status) && !node.archived) {
      runnableSet.add(node.id);
    } else {
      ineligible.push(node.id);
    }
  }

  const resolveDepStatus = (depId: string): string =>
    statusById.get(depId) ?? externalStatuses.get(depId) ?? UNKNOWN_STATUS;

  type EdgeKind = 'satisfied' | 'in-batch' | 'external';
  const classifyEdge = (depId: string): EdgeKind => {
    const status = resolveDepStatus(depId);
    if (TERMINAL_STATUSES.has(status)) return 'satisfied';
    if (runnableSet.has(depId)) return 'in-batch';
    // Runnable status outside this batch, in-flight (running/scheduled), or
    // unknown — all block until something else completes them.
    return 'external';
  };

  // Seed externally-blocked set with runnable nodes that have any external dep.
  const externallyBlocked = new Set<string>();
  const inBatchUpstream = new Map<string, string[]>(); // node → its in-batch upstream deps
  const inBatchDownstream = new Map<string, string[]>(); // upstream → in-batch dependents
  for (const id of runnableSet) {
    inBatchUpstream.set(id, []);
    inBatchDownstream.set(id, []);
  }

  for (const node of nodes) {
    if (!runnableSet.has(node.id)) continue;
    for (const dep of node.dependsOn) {
      const kind = classifyEdge(dep);
      if (kind === 'satisfied') continue;
      if (kind === 'external') {
        externallyBlocked.add(node.id);
        continue;
      }
      // in-batch
      inBatchUpstream.get(node.id)!.push(dep);
      inBatchDownstream.get(dep)!.push(node.id);
    }
  }

  // Propagate external blockage through in-batch edges: anything downstream of
  // an externally-blocked node is itself blocked (its blocker won't finish in
  // this batch either).
  const blockQueue = [...externallyBlocked];
  while (blockQueue.length > 0) {
    const id = blockQueue.shift()!;
    for (const child of inBatchDownstream.get(id) ?? []) {
      if (!externallyBlocked.has(child)) {
        externallyBlocked.add(child);
        blockQueue.push(child);
      }
    }
  }

  // Eligible = runnable AND not externally blocked. Run Kahn over this subset.
  const eligibleSet = new Set<string>();
  for (const id of runnableSet) if (!externallyBlocked.has(id)) eligibleSet.add(id);

  const inDegree = new Map<string, number>();
  for (const id of eligibleSet) {
    const upstream = inBatchUpstream.get(id) ?? [];
    inDegree.set(id, upstream.filter((u) => eligibleSet.has(u)).length);
  }

  const layers: string[][] = [];
  let frontier = [...eligibleSet].filter((id) => (inDegree.get(id) ?? 0) === 0);
  const placed = new Set<string>();

  while (frontier.length > 0) {
    const layer = [...frontier].sort();
    layers.push(layer);
    for (const id of layer) placed.add(id);

    const nextFrontier: string[] = [];
    for (const id of layer) {
      for (const child of inBatchDownstream.get(id) ?? []) {
        if (!eligibleSet.has(child)) continue;
        const remaining = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, remaining);
        if (remaining === 0) nextFrontier.push(child);
      }
    }
    frontier = nextFrontier;
  }

  const unplaced = [...eligibleSet].filter((id) => !placed.has(id));
  const cycles = findCycleMembers(unplaced, inBatchDownstream);
  const blockedByCycle = unplaced.filter((id) => !cycles.includes(id));

  const totalRunnable = layers.reduce((sum, layer) => sum + layer.length, 0);

  return {
    alreadyDone: alreadyDone.sort(),
    blockedByCycle: blockedByCycle.sort(),
    blockedExternally: [...externallyBlocked].sort(),
    cycles: cycles.sort(),
    ineligible: ineligible.sort(),
    layers,
    totalRunnable,
  };
};

/**
 * Identify nodes that lie on a cycle inside the residual subgraph.
 * Nodes left in `unplaced` are either on a cycle or downstream of one;
 * we walk forward from each candidate and flag those that can reach themselves.
 */
const findCycleMembers = (unplaced: string[], downstream: Map<string, string[]>): string[] => {
  const candidates = new Set(unplaced);
  const cycleMembers = new Set<string>();

  for (const start of unplaced) {
    if (cycleMembers.has(start)) continue;
    const stack = [start];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const node = stack.pop()!;
      for (const child of downstream.get(node) ?? []) {
        if (!candidates.has(child)) continue;
        if (child === start) {
          cycleMembers.add(start);
          break;
        }
        if (!visited.has(child)) {
          visited.add(child);
          stack.push(child);
        }
      }
      if (cycleMembers.has(start)) break;
    }
  }

  return [...cycleMembers];
};

export class TaskGraphService {
  private taskModel: TaskModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.taskModel = new TaskModel(db, userId, workspaceId);
  }

  /**
   * Build a layered execution plan for the descendants of a parent task.
   * Returns layers in dependency order plus diagnostics (cycles, skipped, etc.).
   *
   * Cross-scope dependencies (a descendant depending on a task outside this
   * subtree) are resolved by fetching the upstream's status; if it's not yet
   * `completed`/`canceled` the dependent is recorded as `blockedExternally`
   * rather than placed in a layer.
   */
  async planForParent(parentTaskId: string): Promise<{
    descendants: TaskItem[];
    plan: SubtaskGraphPlan;
  }> {
    const descendants = await this.taskModel.findAllDescendants(parentTaskId);
    if (descendants.length === 0) {
      return {
        descendants: [],
        plan: {
          alreadyDone: [],
          blockedByCycle: [],
          blockedExternally: [],
          cycles: [],
          ineligible: [],
          layers: [],
          totalRunnable: 0,
        },
      };
    }

    const ids = descendants.map((d) => d.id);
    const deps = await this.taskModel.getDependenciesByTaskIds(ids);
    const descendantIds = new Set(ids);
    const externalIds = [
      ...new Set(
        deps
          .filter((dep) => dep.type === 'blocks' && !descendantIds.has(dep.dependsOnId))
          .map((dep) => dep.dependsOnId),
      ),
    ];
    const upstreams = externalIds.length ? await this.taskModel.findByIds(externalIds) : [];
    const externalStatuses = new Map(upstreams.map((task) => [task.id, task.status]));
    const knownIds = new Set([...ids, ...upstreams.map((task) => task.id)]);
    const dependsOnById = new Map<string, string[]>();
    let missingCounter = 0;
    for (const dep of deps) {
      if (dep.type !== 'blocks' || !descendantIds.has(dep.taskId)) continue;
      const list = dependsOnById.get(dep.taskId) ?? [];
      list.push(knownIds.has(dep.dependsOnId) ? dep.dependsOnId : `__missing:${missingCounter++}`);
      dependsOnById.set(dep.taskId, list);
    }
    const nodes = descendants.map((task) => ({
      archived: !!task.archivedAt,
      dependsOn: dependsOnById.get(task.id) ?? [],
      id: task.id,
      identifier: task.identifier,
      status: task.status,
    }));

    return { descendants, plan: planSubtaskLayers(nodes, externalStatuses) };
  }
}

/** Keep identifier outputs for older clients, adding stable references alongside. */
export const displaySubtaskPlan = (plan: SubtaskGraphPlan, descendants: TaskItem[]) => {
  const byId = new Map(descendants.map((task) => [task.id, task]));
  const tasks = (ids: string[]) =>
    ids.map((id) => ({ id, identifier: byId.get(id)?.identifier ?? id }));
  const identifiers = (ids: string[]) => tasks(ids).map((task) => task.identifier);
  return {
    alreadyDone: identifiers(plan.alreadyDone),
    alreadyDoneTasks: tasks(plan.alreadyDone),
    blockedByCycle: identifiers(plan.blockedByCycle),
    blockedByCycleTasks: tasks(plan.blockedByCycle),
    blockedExternally: identifiers(plan.blockedExternally),
    blockedExternallyTasks: tasks(plan.blockedExternally),
    cycles: identifiers(plan.cycles),
    cyclesTasks: tasks(plan.cycles),
    ineligible: identifiers(plan.ineligible),
    ineligibleTasks: tasks(plan.ineligible),
    layers: plan.layers.map(identifiers),
    layerTasks: plan.layers.map(tasks),
    totalRunnable: plan.totalRunnable,
  };
};
