import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { ProjectModel } from '../../../models/project';
import { TaskModel } from '../../../models/task';
import { TopicModel } from '../../../models/topic';
import { tasks, topics, users } from '../../../schemas';
import { ProjectRepository } from '../../project';
import { ProjectOverviewRepository } from '../index';

const serverDB = await getTestDB();
const userId = 'project-overview-user';
const otherUserId = 'project-overview-other-user';
const projectRepo = new ProjectRepository(serverDB, userId);
const model = new ProjectModel(serverDB, userId);
const repo = new ProjectOverviewRepository(serverDB, userId);
let identifierSequence = 0;

const createProject = (name: string, owner = projectRepo) =>
  owner.create({ identifier: `O${String(++identifierSequence).padStart(5, '0')}`, name });

const createTopic = async (
  projectId: string,
  title: string,
  updatedAt: Date,
  extra: { description?: string; historySummary?: string } = {},
) => {
  const topic = await new TopicModel(serverDB, userId).create({ projectId, title });
  await serverDB
    .update(topics)
    .set({ ...extra, updatedAt })
    .where(eq(topics.id, topic.id));
  return topic;
};

describe('ProjectOverviewRepository.list', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('returns nothing when the caller has no projects', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('batches topics, tasks and members per project', async () => {
    const project = await createProject('Folder');
    const empty = await createProject('Empty');

    await createTopic(project.id, 'Oldest', new Date('2026-01-01'));
    await createTopic(project.id, 'Second', new Date('2026-01-02'));
    await createTopic(project.id, 'Third', new Date('2026-01-03'));
    await createTopic(project.id, 'Fourth', new Date('2026-01-04'), { description: 'not shown' });
    await createTopic(project.id, 'Latest', new Date('2026-01-05'), {
      historySummary: 'Summarized history',
    });
    const deleted = await createTopic(project.id, 'Deleted', new Date('2026-01-06'));
    await serverDB.update(topics).set({ deletedAt: new Date() }).where(eq(topics.id, deleted.id));

    const taskModel = new TaskModel(serverDB, userId);
    const done = await taskModel.create({ instruction: 'Done', projectId: project.id });
    await taskModel.create({ instruction: 'Open', projectId: project.id });
    const canceled = await taskModel.create({ instruction: 'Dropped', projectId: project.id });
    await serverDB.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, done.id));
    await serverDB.update(tasks).set({ status: 'canceled' }).where(eq(tasks.id, canceled.id));

    const agentModel = new AgentModel(serverDB, userId);
    for (const [index, title] of ['Writer', 'Reviewer', 'Tester'].entries()) {
      const agent = await agentModel.create({ title });
      await model.addAgent(project.id, { agentId: agent.id, sortOrder: index + 1 });
    }

    const overviews = await repo.list();
    const overview = overviews.find((item) => item.projectId === project.id)!;

    expect(overview.topicCount).toBe(5);
    expect(overview.recentTopics.map((topic) => topic.title)).toEqual([
      'Latest',
      'Fourth',
      'Third',
      'Second',
    ]);
    expect(overview.recentTopics.map((topic) => topic.summary)).toEqual([
      'Summarized history',
      null,
      null,
      null,
    ]);
    expect(overview.recentTopics[0].updatedAt).toBeInstanceOf(Date);
    expect(overview).toMatchObject({ taskCount: 2, taskDoneCount: 1 });

    // The main agent leads, then the project order, capped at three.
    expect(overview.agentCount).toBe(4);
    expect(overview.agents.map((agent) => agent.id)).toEqual([
      project.coordinatorAgentId,
      ...(await model.listAgents(project.id))!.slice(1, 3).map(({ agent }) => agent.id),
    ]);
    expect(overview.agents[1].title).toBe('Writer');

    // A project with only its main agent still gets a card overview.
    expect(overviews.find((item) => item.projectId === empty.id)).toMatchObject({
      agentCount: 1,
      recentTopics: [],
      taskCount: 0,
      topicCount: 0,
    });
  });

  it('prefers a topic description over its history summary', async () => {
    const project = await createProject('Described');
    await createTopic(project.id, 'Only', new Date('2026-02-01'), {
      description: 'Short description',
      historySummary: 'Long summary',
    });

    const [overview] = await repo.list();

    expect(overview.recentTopics[0].summary).toBe('Short description');
  });

  it('leaves out projects the caller cannot see', async () => {
    await createProject('Foreign', new ProjectRepository(serverDB, otherUserId));

    expect(await repo.list()).toEqual([]);
  });
});
