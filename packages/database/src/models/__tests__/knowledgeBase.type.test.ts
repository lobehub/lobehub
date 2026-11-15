// @vitest-environment node
import type { KnowledgeBaseItem } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  agentsKnowledgeBases,
  knowledgeBases,
  projectKnowledgeBases,
  projects,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { KnowledgeBaseModel } from '../knowledgeBase';
import { ProjectModel } from '../project';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'kb-type-test-user';
const otherUserId = 'kb-type-test-other-user';
const agentId = 'kb-type-test-agent';
const projectId = 'kb-type-test-project';

const knowledgeBaseModel = new KnowledgeBaseModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  await serverDB.insert(knowledgeBases).values([
    { id: 'kb-user', name: 'User library', userId },
    { id: 'kb-custom', name: 'Other typed library', type: 'custom', userId },
    { id: 'kb-agent', name: 'Agent space', type: 'agent', userId },
    { id: 'kb-project', name: 'Project space', type: 'project', userId },
    { id: 'kb-other-user', name: 'Not mine', userId: otherUserId },
  ]);
});

describe('dedicated knowledge bases', () => {
  it('leaves agent and project spaces out of library lists, keeping NULL and other types', async () => {
    const ids = (await knowledgeBaseModel.query()).map(({ id }) => id).sort();

    expect(ids).toEqual(['kb-custom', 'kb-user']);
  });

  it('still applies the visibility filter', async () => {
    await serverDB
      .update(knowledgeBases)
      .set({ visibility: 'private' })
      .where(eq(knowledgeBases.id, 'kb-user'));

    const ids = (await knowledgeBaseModel.query({ visibility: 'private' })).map(({ id }) => id);

    expect(ids).toEqual(['kb-user']);
  });

  it('keeps a dedicated space reachable by id for its owner flows', async () => {
    await expect(knowledgeBaseModel.findById('kb-agent')).resolves.toMatchObject({ type: 'agent' });
  });

  it('never lets the generic update change a library type', async () => {
    await knowledgeBaseModel.update('kb-user', {
      name: 'Renamed',
      type: 'agent',
    } as Partial<KnowledgeBaseItem>);

    await expect(knowledgeBaseModel.findById('kb-user')).resolves.toMatchObject({
      name: 'Renamed',
      type: null,
    });
  });

  it('hides a dedicated mount from agent knowledge but keeps unavailable mounts', async () => {
    await serverDB.insert(agents).values({ id: agentId, userId });
    await serverDB.insert(agentsKnowledgeBases).values([
      { agentId, knowledgeBaseId: 'kb-user', userId },
      { agentId, knowledgeBaseId: 'kb-agent', enabled: false, userId },
      // Another user's library fails the join guard: the mount survives as a placeholder.
      { agentId, knowledgeBaseId: 'kb-other-user', userId },
    ]);

    const { knowledgeBases: mounted } = await new AgentModel(
      serverDB,
      userId,
    ).getAgentAssignedKnowledge(agentId);

    expect(mounted).toHaveLength(2);
    expect(mounted.map(({ id }) => id)).toContain('kb-user');
    expect(mounted.map(({ id }) => id)).not.toContain('kb-agent');
    expect(mounted.some(({ id }) => id === null || id === undefined)).toBe(true);
  });

  it('refuses to mount a dedicated space on an agent or project', async () => {
    await serverDB.insert(agents).values({ id: agentId, userId });
    await serverDB.insert(projects).values({ id: projectId, name: 'Project', userId });

    await expect(
      new AgentModel(serverDB, userId).createAgentKnowledgeBase(agentId, 'kb-agent'),
    ).rejects.toThrow('cannot be mounted');
    await expect(
      new ProjectModel(serverDB, userId).addKnowledgeBase(projectId, {
        knowledgeBaseId: 'kb-project',
      }),
    ).rejects.toThrow('Knowledge base not found');
  });

  it('hides a dedicated mount from project knowledge and retrieval', async () => {
    await serverDB.insert(projects).values({ id: projectId, name: 'Project', userId });
    await serverDB.insert(projectKnowledgeBases).values([
      { knowledgeBaseId: 'kb-user', projectId },
      { knowledgeBaseId: 'kb-project', projectId },
    ]);
    const projectModel = new ProjectModel(serverDB, userId);

    const listed = await projectModel.listKnowledgeBases(projectId);

    expect(listed?.map(({ knowledgeBase }) => knowledgeBase.id)).toEqual(['kb-user']);
    await expect(projectModel.getEnabledKnowledgeBaseIds(projectId)).resolves.toEqual(['kb-user']);
  });
});
