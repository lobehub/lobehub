import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { ProjectModel } from '../../../models/project';
import { TaskModel } from '../../../models/task';
import { tasks, users } from '../../../schemas';
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

const createTask = async (
  projectId: string,
  name: string,
  updatedAt: Date,
  extra: { description?: string; status?: string } = {},
) => {
  const task = await new TaskModel(serverDB, userId).create({
    instruction: name,
    name,
    projectId,
  });
  await serverDB
    .update(tasks)
    .set({ ...extra, updatedAt })
    .where(eq(tasks.id, task.id));
  return task;
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

  it('batches tasks and members per project', async () => {
    const project = await createProject('Folder');
    const empty = await createProject('Empty');

    await createTask(project.id, 'Oldest', new Date('2026-01-01'), { status: 'completed' });
    await createTask(project.id, 'Second', new Date('2026-01-02'));
    await createTask(project.id, 'Third', new Date('2026-01-03'));
    await createTask(project.id, 'Fourth', new Date('2026-01-04'), { description: 'not shown' });
    await createTask(project.id, 'Latest', new Date('2026-01-05'), {
      description: 'Latest brief',
      status: 'running',
    });
    await createTask(project.id, 'Dropped', new Date('2026-01-06'), { status: 'canceled' });

    const agentModel = new AgentModel(serverDB, userId);
    for (const [index, title] of ['Writer', 'Reviewer', 'Tester'].entries()) {
      const agent = await agentModel.create({ title });
      await model.addAgent(project.id, { agentId: agent.id, sortOrder: index + 1 });
    }

    const overviews = await repo.list();
    const overview = overviews.find((item) => item.projectId === project.id)!;

    // Canceled tasks leave both the rows and the total.
    expect(overview).toMatchObject({ taskCount: 5, taskDoneCount: 1 });
    expect(overview.recentTasks.map((task) => task.name)).toEqual([
      'Latest',
      'Fourth',
      'Third',
      'Second',
    ]);
    expect(overview.recentTasks.map((task) => task.summary)).toEqual([
      'Latest brief',
      null,
      null,
      null,
    ]);
    expect(overview.recentTasks[0]).toMatchObject({ status: 'running' });
    expect(overview.recentTasks[0].identifier).toBeTruthy();
    expect(overview.recentTasks[0].updatedAt).toBeInstanceOf(Date);

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
      recentTasks: [],
      taskCount: 0,
    });
  });

  it('leaves the summary empty when the latest task has no description', async () => {
    const project = await createProject('Undescribed');
    await createTask(project.id, 'Only', new Date('2026-02-01'), { description: '' });

    const [overview] = await repo.list();

    expect(overview.recentTasks[0].summary).toBeNull();
  });

  it('leaves out projects the caller cannot see', async () => {
    await createProject('Foreign', new ProjectRepository(serverDB, otherUserId));

    expect(await repo.list()).toEqual([]);
  });
});
