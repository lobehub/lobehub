import type { TaskItem } from '@lobechat/types';

import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';

export type SubtaskRunnableStatus = 'backlog' | 'paused' | 'failed';

const RUNNABLE_STATUSES: ReadonlySet<string> = new Set<SubtaskRunnableStatus>([
  'backlog',
  'paused',
  'failed',
]);
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'canceled']);

export interface SubtaskGraphInput {
  /** Identifier of a task that prevents another from running. */
  dependsOnIdentifier: string;
  /** Identifier of the dependent task. */
  taskIdentifier: string;
}

export interface SubtaskGraphPlan {
  /** Tasks that already finished (completed / canceled) and are skipped. */
  alreadyDone: string[];
  /** Tasks blocked by an unbroken cycle and therefore unreachable. */
  blockedByCycle: string[];
  /** Identifiers participating in at least one dependency cycle. */
  cycles: string[];
  /** Tasks ineligible because of status (e.g. running, scheduled). */
  ineligible: string[];
  /** Topologically sorted layers of runnable tasks. Layer N waits on layer N-1. */
  layers: string[][];
  /** Total runnable tasks across all layers. */
  totalRunnable: number;
}

export interface SubtaskNode {
  /** Tasks this one depends on (must be `completed` first). */
  dependsOn: string[];
  identifier: string;
  status: string;
}

/**
 * Group runnable subtasks into topological layers using Kahn's algorithm.
 *
 * - A task is *runnable* when its status ∈ `RUNNABLE_STATUSES`.
 * - A dependency edge is *active* only when the upstream is itself runnable —
 *   already-`completed` upstreams are dropped (they're done, no need to wait).
 * - Tasks left unplaced after the sort participate in (or are blocked by) a cycle.
 */
export const planSubtaskLayers = (nodes: SubtaskNode[]): SubtaskGraphPlan => {
  const alreadyDone: string[] = [];
  const ineligible: string[] = [];
  const runnableSet = new Set<string>();

  for (const node of nodes) {
    if (TERMINAL_STATUSES.has(node.status)) {
      alreadyDone.push(node.identifier);
    } else if (RUNNABLE_STATUSES.has(node.status)) {
      runnableSet.add(node.identifier);
    } else {
      ineligible.push(node.identifier);
    }
  }

  // Build adjacency only for runnable nodes; drop edges to non-runnable upstreams,
  // since a `completed` upstream no longer blocks and a `running` upstream
  // doesn't belong to this batch.
  const inDegree = new Map<string, number>();
  const downstream = new Map<string, string[]>();
  for (const id of runnableSet) {
    inDegree.set(id, 0);
    downstream.set(id, []);
  }

  for (const node of nodes) {
    if (!runnableSet.has(node.identifier)) continue;
    for (const dep of node.dependsOn) {
      if (!runnableSet.has(dep)) continue;
      inDegree.set(node.identifier, (inDegree.get(node.identifier) ?? 0) + 1);
      downstream.get(dep)!.push(node.identifier);
    }
  }

  const layers: string[][] = [];
  let frontier = [...runnableSet].filter((id) => (inDegree.get(id) ?? 0) === 0);
  const placed = new Set<string>();

  while (frontier.length > 0) {
    const layer = [...frontier].sort();
    layers.push(layer);
    for (const id of layer) placed.add(id);

    const nextFrontier: string[] = [];
    for (const id of layer) {
      for (const child of downstream.get(id) ?? []) {
        const remaining = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, remaining);
        if (remaining === 0) nextFrontier.push(child);
      }
    }
    frontier = nextFrontier;
  }

  const unplaced = [...runnableSet].filter((id) => !placed.has(id));
  const cycles = findCycleMembers(unplaced, downstream);
  const blockedByCycle = unplaced.filter((id) => !cycles.includes(id));

  const totalRunnable = layers.reduce((sum, layer) => sum + layer.length, 0);

  return {
    alreadyDone: alreadyDone.sort(),
    blockedByCycle: blockedByCycle.sort(),
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

  constructor(db: LobeChatDatabase, userId: string) {
    this.taskModel = new TaskModel(db, userId);
  }

  /**
   * Build a layered execution plan for the descendants of a parent task.
   * Returns layers in dependency order plus diagnostics (cycles, skipped, etc.).
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
          cycles: [],
          ineligible: [],
          layers: [],
          totalRunnable: 0,
        },
      };
    }

    const ids = descendants.map((d) => d.id);
    const deps = await this.taskModel.getDependenciesByTaskIds(ids);
    const idToIdentifier = new Map(descendants.map((d) => [d.id, d.identifier]));

    const dependsOnByIdentifier = new Map<string, string[]>();
    for (const dep of deps) {
      if (dep.type !== 'blocks') continue;
      const taskIdentifier = idToIdentifier.get(dep.taskId);
      const upstreamIdentifier = idToIdentifier.get(dep.dependsOnId);
      if (!taskIdentifier || !upstreamIdentifier) continue;
      const list = dependsOnByIdentifier.get(taskIdentifier) ?? [];
      list.push(upstreamIdentifier);
      dependsOnByIdentifier.set(taskIdentifier, list);
    }

    const nodes: SubtaskNode[] = descendants.map((d) => ({
      dependsOn: dependsOnByIdentifier.get(d.identifier) ?? [],
      identifier: d.identifier,
      status: d.status,
    }));

    return { descendants, plan: planSubtaskLayers(nodes) };
  }
}
