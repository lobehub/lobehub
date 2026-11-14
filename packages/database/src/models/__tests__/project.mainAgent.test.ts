import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProjectRepository } from '../../repositories/project';
import {
  agentLabelAssignments,
  agentLabels,
  agents,
  resourcePermissions,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { AgentLabelModel } from '../agentLabel';
import type { CreateProjectInput } from '../project';
import { createProjectMainAgent, PROJECT_AGENT_LABEL } from '../projectMainAgent';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'project-main-agent-user';
const memberId = 'project-main-agent-member';
const workspaceId = 'project-main-agent-workspace';
let projectIdentifierSequence = 0;

const createProject = (repo: ProjectRepository, input: Omit<CreateProjectInput, 'identifier'>) =>
  repo.create({
    ...input,
    identifier: `M${String(++projectIdentifierSequence).padStart(5, '0')}`,
  });

const labelsOf = async (agentId: string) =>
  serverDB
    .select({ id: agentLabels.id, name: agentLabels.name, workspaceId: agentLabels.workspaceId })
    .from(agentLabelAssignments)
    .innerJoin(agentLabels, eq(agentLabels.id, agentLabelAssignments.labelId))
    .where(eq(agentLabelAssignments.agentId, agentId));

describe('the main agent a project creates', () => {
  const repo = new ProjectRepository(serverDB, userId);

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: memberId }]);
  });

  afterEach(async () => {
    await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await serverDB.delete(users);
  });

  it('is an ordinary agent named after the project, wearing its avatar and the Project label', async () => {
    const project = await createProject(repo, { avatar: '🚀', name: 'Apollo' });

    const [agent] = await serverDB
      .select()
      .from(agents)
      .where(eq(agents.id, project.coordinatorAgentId!));
    expect(agent).toEqual(
      expect.objectContaining({ avatar: '🚀', title: 'Apollo Project Agent', virtual: false }),
    );
    // A project runs in the cloud sandbox unless someone picks a device.
    expect(agent.agencyConfig).toEqual({ executionTarget: 'sandbox' });
    expect(await labelsOf(agent.id)).toEqual([
      expect.objectContaining({ name: PROJECT_AGENT_LABEL, workspaceId: null }),
    ]);
    // The label shows up in the agents list with the agent counted under it.
    expect(await new AgentLabelModel(serverDB, userId).query()).toEqual([
      expect.objectContaining({ name: PROJECT_AGENT_LABEL, usageCount: 1 }),
    ]);
  });

  it('takes the ids the create form reserved, so its generated avatars match the preview', async () => {
    const project = await createProject(repo, {
      dedicatedAgentId: 'agt_reservedAgnt',
      id: 'prj_reservedProj',
      name: 'Reserved',
    });

    expect(project.id).toBe('prj_reservedProj');
    expect(project.coordinatorAgentId).toBe('agt_reservedAgnt');
    // The reserved agent id is not a column of the project.
    expect(project).not.toHaveProperty('dedicatedAgentId');
  });

  it('ignores a reserved agent id when the project reuses an existing agent', async () => {
    const existing = await new AgentModel(serverDB, userId).create({ title: 'Existing' });

    const project = await createProject(repo, {
      coordinatorAgentId: existing.id,
      dedicatedAgentId: 'agt_unusedAgent',
      name: 'Reuse',
    });

    expect(project.coordinatorAgentId).toBe(existing.id);
    expect(await serverDB.select().from(agents).where(eq(agents.id, 'agt_unusedAgent'))).toEqual(
      [],
    );
  });

  it('shares one Project label across the projects of a scope', async () => {
    const first = await createProject(repo, { name: 'First' });
    const second = await createProject(repo, { name: 'Second' });

    const [firstLabel] = await labelsOf(first.coordinatorAgentId!);
    const [secondLabel] = await labelsOf(second.coordinatorAgentId!);
    expect(secondLabel.id).toBe(firstLabel.id);
    expect(
      await serverDB.select().from(agentLabels).where(eq(agentLabels.userId, userId)),
    ).toHaveLength(1);
  });

  it('reuses a Project label the user made themselves, but not an archived one', async () => {
    const labels = new AgentLabelModel(serverDB, userId);
    const archived = await labels.create({ name: PROJECT_AGENT_LABEL });
    await labels.update(archived.id, { archived: true });

    const first = await createProject(repo, { name: 'First' });
    const [label] = await labelsOf(first.coordinatorAgentId!);
    expect(label.id).not.toBe(archived.id);

    const second = await createProject(repo, { name: 'Second' });
    expect(await labelsOf(second.coordinatorAgentId!)).toEqual([
      expect.objectContaining({ id: label.id }),
    ]);
  });

  it('labels nothing when the project is led by a picked agent', async () => {
    const picked = await new AgentModel(serverDB, userId).create({ title: 'Planner' });

    await createProject(repo, { coordinatorAgentId: picked.id, name: 'Picked' });

    expect(await labelsOf(picked.id)).toEqual([]);
    expect(
      await serverDB.select().from(agentLabels).where(eq(agentLabels.userId, userId)),
    ).toHaveLength(0);
  });

  it('shares the workspace label between members and opens a public agent to the workspace', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Main Agent Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const ownerRepo = new ProjectRepository(serverDB, userId, workspaceId);
    const memberRepo = new ProjectRepository(serverDB, memberId, workspaceId);

    const shared = await createProject(ownerRepo, { name: 'Shared', visibility: 'public' });
    const own = await createProject(memberRepo, { name: 'Own', visibility: 'private' });

    const [sharedLabel] = await labelsOf(shared.coordinatorAgentId!);
    const [ownLabel] = await labelsOf(own.coordinatorAgentId!);
    expect(sharedLabel).toEqual(
      expect.objectContaining({ name: PROJECT_AGENT_LABEL, workspaceId }),
    );
    expect(ownLabel.id).toBe(sharedLabel.id);

    const agentIds = [shared.coordinatorAgentId!, own.coordinatorAgentId!];
    expect(
      await serverDB
        .select({ visibility: agents.visibility })
        .from(agents)
        .where(eq(agents.id, shared.coordinatorAgentId!)),
    ).toEqual([{ visibility: 'public' }]);
    expect(
      await serverDB
        .select({
          accessLevel: resourcePermissions.accessLevel,
          resourceId: resourcePermissions.resourceId,
        })
        .from(resourcePermissions)
        .where(
          and(
            eq(resourcePermissions.resourceType, 'agent'),
            inArray(resourcePermissions.resourceId, agentIds),
          ),
        ),
    ).toEqual([{ accessLevel: 'edit', resourceId: shared.coordinatorAgentId }]);
  });

  it('adopts the Project label another project created mid-flight', async () => {
    // The label exists, but this caller's first lookup runs before it is visible:
    // the insert then loses the race and has to read the winner's row.
    await new AgentLabelModel(serverDB, userId).create({ name: PROJECT_AGENT_LABEL });
    let labelLookups = 0;
    const proxy = createProxyTestDB(serverDB, (query, result) => {
      if (query.includes('from "agent_labels"')) {
        labelLookups += 1;
        if (labelLookups === 1) return [];
      }
      return result.rows;
    });

    const agent = await createProjectMainAgent(proxy, { userId }, { name: 'Raced' });

    const [label] = await labelsOf(agent.id);
    expect(label).toMatchObject({ name: PROJECT_AGENT_LABEL });
    expect(await serverDB.select().from(agentLabels)).toHaveLength(1);
  });

  it('fails loudly when the Project label can be neither found nor created', async () => {
    const proxy = createProxyTestDB(serverDB, (query, result) => {
      if (query.includes('from "agent_labels"')) return [];
      if (query.startsWith('insert into "agent_labels"')) return [];
      return result.rows;
    });

    await expect(createProjectMainAgent(proxy, { userId }, { name: 'Doomed' })).rejects.toThrow(
      'Failed to create the project agent label',
    );
  });
});
