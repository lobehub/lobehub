// @vitest-environment node
import {
  matchesTaskListFilter,
  TASK_LIST_FILTER_NONE,
  type TaskListFilter,
  toTaskListFilterAgentCreator,
} from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, projects, tasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-filter-test-user-id';
const otherUserId = 'task-filter-test-other-user-id';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { id: 'agt_filter_a', slug: 'agt_filter_a', userId },
    { id: 'agt_filter_b', slug: 'agt_filter_b', userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

/**
 * Five tasks spread over every filterable dimension:
 * - `alpha`  backlog, urgent, agent A, member self, project P, created 2 days ago
 * - `beta`   running, high, agent B, member other, no project, created 20 days ago
 * - `gamma`  completed 3 days ago, priority NULL, no agent, no member, project P
 * - `delta`  completed 60 days ago, low, agent A, created 120 days ago by agent A
 * - `literal` backlog, no priority, its name holds `100%_done`
 */
const seed = async () => {
  const model = new TaskModel(serverDB, userId);
  const [project] = await serverDB
    .insert(projects)
    .values({ name: 'P', userId })
    .returning({ id: projects.id });

  const alpha = await model.create({
    assigneeAgentId: 'agt_filter_a',
    assigneeUserId: userId,
    instruction: 'Build the alpha filter menu',
    name: 'Alpha',
    priority: 1,
    projectId: project.id,
  });
  const beta = await model.create({
    assigneeAgentId: 'agt_filter_b',
    assigneeUserId: otherUserId,
    instruction: 'Beta work',
    name: 'Beta',
    priority: 2,
  });
  const gamma = await model.create({
    instruction: 'Gamma work',
    name: 'Gamma',
    projectId: project.id,
  });
  const delta = await model.create({
    assigneeAgentId: 'agt_filter_a',
    instruction: 'Delta work',
    name: 'Delta',
    priority: 4,
  });
  const literal = await model.create({ instruction: 'Literal work', name: 'Ship 100%_done' });

  await serverDB
    .update(tasks)
    .set({ createdAt: daysAgo(2), updatedAt: daysAgo(1) })
    .where(eq(tasks.id, alpha.id));
  await serverDB
    .update(tasks)
    .set({ createdAt: daysAgo(20), status: 'running', updatedAt: daysAgo(10) })
    .where(eq(tasks.id, beta.id));
  await serverDB
    .update(tasks)
    .set({
      completedAt: daysAgo(3),
      createdAt: daysAgo(5),
      priority: null,
      status: 'completed',
      updatedAt: daysAgo(3),
    })
    .where(eq(tasks.id, gamma.id));
  await serverDB
    .update(tasks)
    .set({
      completedAt: daysAgo(60),
      createdAt: daysAgo(120),
      createdByAgentId: 'agt_filter_a',
      status: 'completed',
      updatedAt: daysAgo(60),
    })
    .where(eq(tasks.id, delta.id));

  return { alpha, beta, delta, gamma, literal, model, projectId: project.id };
};

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe('TaskModel list filter', () => {
  it('narrows by each field and agrees with the JS mirror', async () => {
    const { alpha, beta, delta, gamma, literal, model, projectId } = await seed();
    const all = [alpha, beta, gamma, delta, literal];

    const cases: Array<[TaskListFilter, { id: string }[]]> = [
      [{ status: { operator: 'is', values: ['completed'] } }, [gamma, delta]],
      [{ status: { operator: 'isNot', values: ['completed', 'running'] } }, [alpha, literal]],
      // A NULL priority counts as "no priority".
      [{ priority: { operator: 'is', values: [0] } }, [gamma, literal]],
      [{ priority: { operator: 'isNot', values: [0, 4] } }, [alpha, beta]],
      [{ agent: { operator: 'is', values: ['agt_filter_a'] } }, [alpha, delta]],
      [
        { agent: { operator: 'is', values: ['agt_filter_b', TASK_LIST_FILTER_NONE] } },
        [beta, gamma, literal],
      ],
      // "is not A" keeps the unassigned rows…
      [{ agent: { operator: 'isNot', values: ['agt_filter_a'] } }, [beta, gamma, literal]],
      // …and excluding "none" drops exactly them.
      [{ agent: { operator: 'isNot', values: [TASK_LIST_FILTER_NONE] } }, [alpha, beta, delta]],
      [{ assignee: { operator: 'is', values: [otherUserId] } }, [beta]],
      [{ assignee: { operator: 'is', values: [TASK_LIST_FILTER_NONE] } }, [gamma, delta, literal]],
      // A member still finds the tasks their agents created for them…
      [{ creator: { operator: 'is', values: [userId] } }, all],
      [{ creator: { operator: 'isNot', values: [userId] } }, []],
      // …and the agent value finds only what that agent created; NULL agents stay in `isNot`.
      [
        { creator: { operator: 'isNot', values: [toTaskListFilterAgentCreator('agt_filter_a')] } },
        [alpha, beta, gamma, literal],
      ],
      [
        { creator: { operator: 'is', values: [toTaskListFilterAgentCreator('agt_filter_a')] } },
        [delta],
      ],
      [
        {
          creator: {
            operator: 'is',
            values: [userId, toTaskListFilterAgentCreator('agt_filter_a')],
          },
        },
        all,
      ],
      [{ project: { operator: 'is', values: [projectId] } }, [alpha, gamma]],
      [{ project: { operator: 'isNot', values: [projectId, TASK_LIST_FILTER_NONE] } }, []],
      [{ createdAt: { operator: 'within', window: 'week' } }, [alpha, gamma, literal]],
      [{ createdAt: { operator: 'before', window: 'quarter' } }, [delta]],
      [{ updatedAt: { operator: 'before', window: 'week' } }, [beta, delta]],
      // Unfinished tasks have no completedAt and match neither side.
      [{ completedAt: { operator: 'within', window: 'week' } }, [gamma]],
      [{ completedAt: { operator: 'before', window: 'month' } }, [delta]],
      [{ content: 'ALPHA FILTER' }, [alpha]],
      [{ content: 'work' }, [beta, gamma, delta, literal]],
      // LIKE wildcards in the text are literal.
      [{ content: '100%_' }, [literal]],
      [{ content: '%' }, [literal]],
      [{ content: '_' }, [literal]],
      // Fields are ANDed.
      [
        {
          agent: { operator: 'is', values: ['agt_filter_a'] },
          status: { operator: 'is', values: ['completed'] },
        },
        [delta],
      ],
    ];

    const rows = await model.list({ limit: 100 });
    for (const [filter, expected] of cases) {
      const result = await model.list({ filter, limit: 100, now: NOW });
      expect(ids(result.tasks), JSON.stringify(filter)).toEqual(ids(expected));
      expect(result.total, JSON.stringify(filter)).toBe(expected.length);
      expect(
        ids(rows.tasks.filter((task) => matchesTaskListFilter(task, filter, NOW))),
        `JS mirror of ${JSON.stringify(filter)}`,
      ).toEqual(ids(expected));
    }
  });

  it('applies the filter to every groupList shape', async () => {
    const { alpha, delta, model } = await seed();
    const filter: TaskListFilter = { agent: { operator: 'is', values: ['agt_filter_a'] } };

    const statusGroups = await model.groupList({
      filter,
      groups: [
        { key: 'backlog', statuses: ['backlog'] },
        { key: 'done', statuses: ['completed'] },
      ],
    });
    const byKey = new Map(statusGroups.map((group) => [group.key, group]));
    expect(ids(byKey.get('backlog')!.tasks)).toEqual([alpha.id]);
    expect(byKey.get('backlog')!.total).toBe(1);
    expect(ids(byKey.get('done')!.tasks)).toEqual([delta.id]);

    const priorityGroups = await model.groupList({ filter, groupBy: 'priority' });
    const priorityTasks = priorityGroups.flatMap((group) => group.tasks);
    expect(ids(priorityTasks)).toEqual(ids([alpha, delta]));

    const agentGroups = await model.groupList({ filter, groupBy: 'agent' });
    expect(ids(agentGroups.flatMap((group) => group.tasks))).toEqual(ids([alpha, delta]));
  });

  it('cannot widen ownership: another user sees nothing of these tasks', async () => {
    await seed();
    const other = new TaskModel(serverDB, otherUserId);
    const result = await other.list({
      filter: { assignee: { operator: 'is', values: [otherUserId] } },
    });
    expect(result.tasks).toEqual([]);
  });
});
