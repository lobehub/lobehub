import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { ProjectModel } from '../../../models/project';
import { TaskModel } from '../../../models/task';
import { TopicModel } from '../../../models/topic';
import {
  agentDocuments,
  agents,
  briefs,
  chatGroups,
  chatGroupsAgents,
  dashboards,
  documents,
  messages,
  taskComments,
  tasks,
  topics,
  users,
  widgets,
} from '../../../schemas';
import { ProjectCoordinatorRepository } from '../index';

const serverDB = await getTestDB();
const userId = 'project-coordinator-user';
const otherUserId = 'project-coordinator-other-user';
const model = new ProjectModel(serverDB, userId);
const repo = new ProjectCoordinatorRepository(serverDB, userId);
const otherRepo = new ProjectCoordinatorRepository(serverDB, otherUserId);
let identifierSequence = 0;

const createProject = (input: { name: string }) =>
  model.create({ ...input, identifier: `C${String(++identifierSequence).padStart(5, '0')}` });

describe('ProjectCoordinatorRepository.replaceCoordinator', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('hands a dedicated coordinator history to the new main agent, then deletes it', async () => {
    const project = await createProject({ name: 'Handover' });
    const coordinatorId = project.coordinatorAgentId;
    const lead = await new AgentModel(serverDB, userId).create({ title: 'Lead' });
    const topic = await new TopicModel(serverDB, userId).create({
      agentId: coordinatorId,
      projectId: project.id,
      title: 'Planning',
    });
    const [message] = await serverDB
      .insert(messages)
      .values({
        agentId: coordinatorId,
        content: 'hi',
        role: 'assistant',
        topicId: topic.id,
        userId,
      })
      .returning();
    const [addressed] = await serverDB
      .insert(messages)
      .values({
        content: 'Plan the release',
        role: 'user',
        targetId: coordinatorId,
        topicId: topic.id,
        userId,
      })
      .returning();
    const task = await new TaskModel(serverDB, userId).create({
      assigneeAgentId: coordinatorId,
      createdByAgentId: coordinatorId,
      instruction: 'Ship it',
      projectId: project.id,
    });
    await serverDB.insert(taskComments).values({
      authorAgentId: coordinatorId,
      content: 'Checklist drafted',
      taskId: task.id,
      userId,
    });
    await serverDB.insert(briefs).values({
      agentId: coordinatorId,
      summary: 'Ready',
      taskId: task.id,
      title: 'Result',
      type: 'result',
      userId,
    });
    await serverDB.insert(documents).values({
      content: 'plan',
      fileType: 'text/markdown',
      filename: 'plan.md',
      id: 'doc-handover-plan',
      source: `agent-document://${coordinatorId}/plan.md`,
      sourceType: 'agent',
      title: 'Plan',
      totalCharCount: 4,
      totalLineCount: 1,
      userId,
    });
    await serverDB
      .insert(agentDocuments)
      .values({ agentId: coordinatorId, documentId: 'doc-handover-plan', userId });
    const [widget] = await serverDB
      .insert(widgets)
      .values({ agentId: coordinatorId, projectId: project.id, title: 'Burndown', userId })
      .returning();
    const [board] = await serverDB
      .insert(dashboards)
      .values({ agentId: coordinatorId, projectId: project.id, title: 'Release', userId })
      .returning();

    const updated = await repo.replaceCoordinator(project.id, lead.id);

    expect(updated?.coordinatorAgentId).toBe(lead.id);
    expect(await serverDB.select().from(agents).where(eq(agents.id, coordinatorId))).toEqual([]);
    expect(await serverDB.select().from(topics).where(eq(topics.id, topic.id))).toEqual([
      expect.objectContaining({ agentId: lead.id }),
    ]);
    expect(await serverDB.select().from(messages).where(eq(messages.id, message.id))).toEqual([
      expect.objectContaining({ agentId: lead.id }),
    ]);
    expect(await serverDB.select().from(messages).where(eq(messages.id, addressed.id))).toEqual([
      expect.objectContaining({ targetId: lead.id }),
    ]);
    expect(await serverDB.select().from(tasks).where(eq(tasks.id, task.id))).toEqual([
      expect.objectContaining({ assigneeAgentId: lead.id, createdByAgentId: lead.id }),
    ]);
    expect(
      await serverDB.select().from(taskComments).where(eq(taskComments.taskId, task.id)),
    ).toEqual([expect.objectContaining({ authorAgentId: lead.id })]);
    expect(await serverDB.select().from(briefs).where(eq(briefs.taskId, task.id))).toEqual([
      expect.objectContaining({ agentId: lead.id }),
    ]);
    expect(
      await serverDB
        .select()
        .from(agentDocuments)
        .where(eq(agentDocuments.documentId, 'doc-handover-plan')),
    ).toEqual([expect.objectContaining({ agentId: lead.id })]);
    expect(await model.listAgents(project.id)).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ id: lead.id }),
        binding: expect.objectContaining({ enabled: true }),
      }),
    ]);
    expect(await serverDB.select().from(widgets).where(eq(widgets.id, widget.id))).toEqual([
      expect.objectContaining({ agentId: lead.id }),
    ]);
    expect(await serverDB.select().from(dashboards).where(eq(dashboards.id, board.id))).toEqual([
      expect.objectContaining({ agentId: lead.id }),
    ]);
  });

  it('keeps a group member that leads a project when it is replaced', async () => {
    const project = await createProject({ name: 'Group lead' });
    const member = await new AgentModel(serverDB, userId).create({
      title: 'Group member',
      virtual: true,
    });
    await serverDB.insert(chatGroups).values({ id: 'project-lead-group', title: 'G', userId });
    await serverDB
      .insert(chatGroupsAgents)
      .values({ agentId: member.id, chatGroupId: 'project-lead-group', userId });
    const lead = await new AgentModel(serverDB, userId).create({ title: 'Lead' });

    await repo.replaceCoordinator(project.id, member.id);
    await repo.replaceCoordinator(project.id, lead.id);

    expect(await serverDB.select().from(agents).where(eq(agents.id, member.id))).toHaveLength(1);
  });

  it('keeps a coordinator that another project counts as a member when it is replaced', async () => {
    const project = await createProject({ name: 'Origin' });
    const other = await createProject({ name: 'Borrower' });
    const coordinatorId = project.coordinatorAgentId;
    await model.addAgent(other.id, { agentId: coordinatorId, role: 'Advisor' });
    const topic = await new TopicModel(serverDB, userId).create({
      agentId: coordinatorId,
      projectId: other.id,
      title: 'Borrowed work',
    });
    const lead = await new AgentModel(serverDB, userId).create({ title: 'Lead' });

    await repo.replaceCoordinator(project.id, lead.id);

    expect(await serverDB.select().from(agents).where(eq(agents.id, coordinatorId))).toHaveLength(
      1,
    );
    expect(await serverDB.select().from(topics).where(eq(topics.id, topic.id))).toEqual([
      expect.objectContaining({ agentId: coordinatorId }),
    ]);
    expect(await model.listAgents(other.id)).toContainEqual(
      expect.objectContaining({ agent: expect.objectContaining({ id: coordinatorId }) }),
    );
  });

  it('keeps a reusable main agent as a member when it is replaced', async () => {
    const project = await createProject({ name: 'Rotation' });
    const agentModel = new AgentModel(serverDB, userId);
    const first = await agentModel.create({ title: 'First lead' });
    const second = await agentModel.create({ title: 'Second lead' });
    await model.addAgent(project.id, { agentId: second.id, enabled: false, role: 'Reviewer' });

    await repo.replaceCoordinator(project.id, first.id);
    const updated = await repo.replaceCoordinator(project.id, second.id);

    expect(updated?.coordinatorAgentId).toBe(second.id);
    expect(await serverDB.select().from(agents).where(eq(agents.id, first.id))).toHaveLength(1);
    expect(await model.listAgents(project.id)).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ id: second.id }),
        binding: expect.objectContaining({ enabled: true, role: 'Reviewer' }),
      }),
      expect.objectContaining({
        agent: expect.objectContaining({ id: first.id }),
        binding: expect.objectContaining({ role: null }),
      }),
    ]);
  });

  it('gives a project that fell back to LobeAI a main agent of its own', async () => {
    const project = await createProject({ name: 'Orphaned' });
    await new AgentModel(serverDB, userId).delete(project.coordinatorAgentId);
    const lead = await new AgentModel(serverDB, userId).create({ title: 'Lead' });

    const updated = await repo.replaceCoordinator(project.id, lead.id);

    expect(updated?.coordinatorAgentId).toBe(lead.id);
    expect(await model.listAgents(project.id)).toEqual([
      expect.objectContaining({ agent: expect.objectContaining({ id: lead.id }) }),
    ]);
  });

  it('refuses to replace the main agent outside the member-management scope', async () => {
    const project = await createProject({ name: 'Guarded' });
    const agent = await new AgentModel(serverDB, otherUserId).create({ title: 'Outsider' });

    expect(await otherRepo.replaceCoordinator(project.id, agent.id)).toBeNull();
    await expect(repo.replaceCoordinator(project.id, agent.id)).rejects.toThrow('Agent not found');
    expect((await model.findById(project.id))?.coordinatorAgentId).toBe(project.coordinatorAgentId);
  });
});
