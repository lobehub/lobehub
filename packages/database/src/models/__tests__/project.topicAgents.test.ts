import { INBOX_SESSION_ID } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, projectAgents, projects, topics, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import type { CreateProjectInput } from '../project';
import { ProjectModel } from '../project';
import { TopicModel } from '../topic';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'project-topic-agents-user';
let projectIdentifierSequence = 0;

const createProject = (projectModel: ProjectModel, input: Omit<CreateProjectInput, 'identifier'>) =>
  projectModel.create({
    ...input,
    identifier: `T${String(++projectIdentifierSequence).padStart(5, '0')}`,
  });

const memberIds = async (model: ProjectModel, projectId: string) =>
  ((await model.listAgents(projectId)) ?? []).map((member) => member.agent.id);

describe('project members from project topics', () => {
  const model = new ProjectModel(serverDB, userId);
  const topicModel = new TopicModel(serverDB, userId);

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('adds the agent of a topic created in the project', async () => {
    const project = await createProject(model, { name: 'Build' });
    const agent = await new AgentModel(serverDB, userId).create({ title: 'Codex' });

    await topicModel.create({ agentId: agent.id, projectId: project.id, title: 'Plan' });

    expect(await memberIds(model, project.id)).toContain(agent.id);
  });

  it('adds the agent when an existing topic moves into the project', async () => {
    const project = await createProject(model, { name: 'Build' });
    const agent = await new AgentModel(serverDB, userId).create({ title: 'Claude Code' });
    const topic = await topicModel.create({ agentId: agent.id, title: 'Loose' });
    expect(await memberIds(model, project.id)).not.toContain(agent.id);

    await topicModel.update(topic.id, { projectId: project.id });

    expect(await memberIds(model, project.id)).toContain(agent.id);
  });

  it('keeps an existing member binding untouched', async () => {
    const project = await createProject(model, { name: 'Build' });
    const agent = await new AgentModel(serverDB, userId).create({ title: 'Reviewer' });
    await model.addAgent(project.id, { agentId: agent.id, enabled: false, role: 'reviewer' });

    await topicModel.create({ agentId: agent.id, projectId: project.id, title: 'Review' });

    const [binding] = await serverDB
      .select()
      .from(projectAgents)
      .where(eq(projectAgents.agentId, agent.id));
    expect(binding).toEqual(expect.objectContaining({ enabled: false, role: 'reviewer' }));
  });

  it('never adds the project coordinator as a regular member', async () => {
    const project = await createProject(model, { name: 'Build' });
    const before = await serverDB
      .select()
      .from(projectAgents)
      .where(eq(projectAgents.projectId, project.id));

    await topicModel.create({
      agentId: project.coordinatorAgentId,
      projectId: project.id,
      title: 'Coordinate',
    });

    expect(
      await serverDB.select().from(projectAgents).where(eq(projectAgents.projectId, project.id)),
    ).toHaveLength(before.length);
  });

  /** @example Review: a project whose main agent was cleared is led by LobeAI. */
  it('never adds LobeAI as a member when it leads a project with a cleared main agent', async () => {
    const project = await createProject(model, { name: 'Cleared' });
    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: null })
      .where(eq(projects.id, project.id));
    const inbox = (await new AgentModel(serverDB, userId).getBuiltinAgent(INBOX_SESSION_ID))!;
    const agent = await new AgentModel(serverDB, userId).create({ title: 'Codex' });

    await topicModel.create({ agentId: inbox.id, projectId: project.id, title: 'Ask LobeAI' });
    await topicModel.create({ agentId: agent.id, projectId: project.id, title: 'Build' });

    const members = await memberIds(model, project.id);
    expect(members).not.toContain(inbox.id);
    expect(members).toContain(agent.id);
  });

  it('keeps private agents out of a shared workspace project', async () => {
    const workspaceId = 'project-topic-agents-workspace';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Topic Agents Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const creator = new ProjectModel(serverDB, userId, workspaceId);
    const sharedProject = await createProject(creator, { name: 'Shared' });
    const [privateAgent] = await serverDB
      .insert(agents)
      .values({ title: 'Private agent', userId, visibility: 'private', workspaceId })
      .returning();

    await new TopicModel(serverDB, userId, workspaceId).create({
      agentId: privateAgent.id,
      projectId: sharedProject.id,
      title: 'Private work',
    });

    expect(await memberIds(creator, sharedProject.id)).not.toContain(privateAgent.id);
  });

  // TODO(2026-12-31): remove with `ProjectModel.joinTopicAgents`.
  it('backfills agents of topics filed before members were added on write', async () => {
    const project = await createProject(model, { name: 'Legacy' });
    const agent = await new AgentModel(serverDB, userId).create({ title: 'Architect' });
    await serverDB
      .insert(topics)
      .values({ agentId: agent.id, id: 'tpc_legacy', projectId: project.id, userId });
    expect(await memberIds(model, project.id)).not.toContain(agent.id);

    await model.joinTopicAgents(project.id);

    expect(await memberIds(model, project.id)).toContain(agent.id);
  });

  // TODO(2026-12-31): remove with `ProjectModel.joinTopicAgents`.
  it('leaves members alone when a read-only viewer opens the project', async () => {
    const project = await createProject(model, { name: 'Legacy' });
    const agent = await new AgentModel(serverDB, userId).create({ title: 'Architect' });
    await serverDB
      .insert(topics)
      .values({ agentId: agent.id, id: 'tpc_legacy_viewer', projectId: project.id, userId });

    await new ProjectModel(serverDB, userId, undefined, { readOnly: true }).joinTopicAgents(
      project.id,
    );

    expect(await memberIds(model, project.id)).not.toContain(agent.id);
  });
});
