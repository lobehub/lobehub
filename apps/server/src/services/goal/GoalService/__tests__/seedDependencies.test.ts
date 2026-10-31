// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { goalEdges, goalEvents, goalNodes, goals, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-seed-dependencies-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  await serverDB.delete(goalEdges);
  await serverDB.delete(goalEvents);
  await serverDB.delete(goalNodes);
  await serverDB.delete(goals);
  await serverDB.delete(users);
});

describe('GoalService.create seed dependencies', () => {
  it('draws each dependsOn as a depends_on edge in the same call that seeds the tasks', async () => {
    const graph = await new GoalService(serverDB, userId).create({
      draft: true,
      tasks: ['Signal', { dependsOn: ['Signal'], description: 'rules', title: 'Policy' }],
      title: 'Wake',
    });

    const idOf = (title: string) =>
      graph.nodes.find((node) => node.kind === 'task' && node.title === title)!.id;
    expect(graph.edges.filter((edge) => edge.kind === 'depends_on')).toEqual([
      expect.objectContaining({ sourceNodeId: idOf('Policy'), targetNodeId: idOf('Signal') }),
    ]);
  });

  it('refuses a dependency cycle before creating the goal', async () => {
    await expect(
      new GoalService(serverDB, userId).create({
        tasks: [
          { dependsOn: ['B'], title: 'A' },
          { dependsOn: ['A'], title: 'B' },
        ],
        title: 'Cyclic',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'dependsOn forms a cycle: "A" → "B" → "A"',
    });
    expect(await serverDB.select().from(goals)).toHaveLength(0);
  });
});
