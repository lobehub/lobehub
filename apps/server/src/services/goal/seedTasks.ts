import type { GoalSeedTask } from '@lobechat/utils/goalSeeds';

import type { GoalGraphModel } from '@/database/models/goalGraph';

/**
 * Attach caller-supplied seed tasks to the goal's problem the way a planned
 * task attaches, then draw each `dependsOn` as a `depends_on` edge. Creating
 * the edges here, in the same call as the nodes, keeps them in place before
 * the goal can dispatch anything, and needs no second write a run's token
 * might not be allowed to make. Callers check `goalSeedDependencyProblem` first.
 */
export const seedGoalTasks = async (
  graph: GoalGraphModel,
  goalId: string,
  problemId: string,
  seeds: Array<GoalSeedTask | string>,
  createdByAgentId?: string,
) => {
  const nodeIdByTitle = new Map<string, string>();
  for (const seed of seeds) {
    const { description, title } = typeof seed === 'string' ? { title: seed } : seed;
    const taskNode = await graph.createNode(goalId, {
      createdByAgentId,
      description,
      kind: 'task',
      title,
    });
    if (!taskNode) throw new Error('Failed to seed goal task');
    await graph.createEdge(goalId, problemId, taskNode.id, 'decomposes');
    nodeIdByTitle.set(title, taskNode.id);
  }
  for (const seed of seeds) {
    if (typeof seed === 'string') continue;
    for (const dep of seed.dependsOn ?? []) {
      await graph.createEdge(
        goalId,
        nodeIdByTitle.get(seed.title)!,
        nodeIdByTitle.get(dep)!,
        'depends_on',
      );
    }
  }
};
