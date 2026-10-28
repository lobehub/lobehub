// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, goalNodes, goals, projects, topics, users } from '../../schemas';
import { ProjectModel } from '../project';
import { TopicModel } from '../topic';

const db = await getTestDB();
const owner = 'topic-goal-owner';
const other = 'topic-goal-other';
const agentId = 'topic-goal-agent';
const projectId = 'topic-goal-project';

const topicIds = ['with-goal', 'graphless-goal', 'trashed-goal', 'foreign-goal', 'no-goal'];

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
  await db.insert(agents).values({ id: agentId, userId: owner });
  await db.insert(projects).values({ id: projectId, name: 'Goals', userId: owner });
  await db
    .insert(topics)
    .values(topicIds.map((id) => ({ agentId, id, projectId, title: id, userId: owner })));
  await db.insert(goals).values([
    { id: 'goal-live', subjectId: 'with-goal', subjectType: 'topic', title: 'g', userId: owner },
    // Created by the earlier task-carried flow: no graph, never listed.
    {
      id: 'goal-graphless',
      subjectId: 'graphless-goal',
      subjectType: 'topic',
      title: 'g',
      userId: owner,
    },
    {
      deletedAt: new Date(),
      id: 'goal-trashed',
      isDeleted: true,
      subjectId: 'trashed-goal',
      subjectType: 'topic',
      title: 'g',
      userId: owner,
    },
    {
      id: 'goal-foreign',
      subjectId: 'foreign-goal',
      subjectType: 'topic',
      title: 'g',
      userId: other,
    },
  ]);
  await db.insert(goalNodes).values(
    ['goal-live', 'goal-trashed', 'goal-foreign'].map((goalId) => ({
      goalId,
      kind: 'problem' as const,
      title: 'problem',
    })),
  );
});

afterEach(async () => {
  await db.delete(users);
});

const expected = {
  'foreign-goal': false,
  'graphless-goal': false,
  'no-goal': false,
  'trashed-goal': false,
  'with-goal': true,
};

const hasGoalById = (rows: { hasGoal?: boolean; id: string }[]) =>
  Object.fromEntries(rows.map((row) => [row.id, row.hasGoal]));

describe('topic goal marker', () => {
  it('marks only topics with a live, owned, graph-carrying goal in the agent list', async () => {
    const { items } = await new TopicModel(db, owner).query({ agentId });

    expect(hasGoalById(items as any)).toEqual(expected);
  });

  it('marks the same topics in the project list', async () => {
    const rows = await new ProjectModel(db, owner).listTopics(projectId);

    expect(hasGoalById(rows)).toEqual(expected);
  });
});
