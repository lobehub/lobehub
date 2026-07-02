// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentDocuments, agents, documents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentDocumentModel } from '../agentDocuments';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-document-workspace-user';
const workspaceId = 'agent-document-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Agent Document Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(agents).values([
    { id: 'personal-agent-document-agent', title: 'Personal Agent', userId, workspaceId: null },
    { id: 'workspace-agent-document-agent', title: 'Workspace Agent', userId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentDocumentModel workspace scope', () => {
  it('isolates document reads and deletes between personal and workspace scopes', async () => {
    const personalModel = new AgentDocumentModel(serverDB, userId);
    const workspaceModel = new AgentDocumentModel(serverDB, userId, workspaceId);

    const personalDoc = await personalModel.create(
      'personal-agent-document-agent',
      'README.md',
      '# Personal',
    );
    const workspaceDoc = await workspaceModel.create(
      'workspace-agent-document-agent',
      'README.md',
      '# Workspace',
    );

    await expect(personalModel.findById(workspaceDoc.id)).resolves.toBeUndefined();
    await expect(workspaceModel.findById(personalDoc.id)).resolves.toBeUndefined();

    await expect(
      serverDB.query.agentDocuments.findFirst({
        where: eq(agentDocuments.id, personalDoc.id),
      }),
    ).resolves.toMatchObject({ id: personalDoc.id, workspaceId: null });
    await expect(
      serverDB.query.agentDocuments.findFirst({
        where: eq(agentDocuments.id, workspaceDoc.id),
      }),
    ).resolves.toMatchObject({ id: workspaceDoc.id, workspaceId });

    await expect(personalModel.findByAgent('personal-agent-document-agent')).resolves.toEqual([
      expect.objectContaining({ id: personalDoc.id }),
    ]);
    await expect(workspaceModel.findByAgent('workspace-agent-document-agent')).resolves.toEqual([
      expect.objectContaining({ id: workspaceDoc.id }),
    ]);

    await personalModel.deleteByAgent('personal-agent-document-agent');

    await expect(personalModel.findById(personalDoc.id)).resolves.toBeUndefined();
    await expect(workspaceModel.findById(workspaceDoc.id)).resolves.toMatchObject({
      id: workspaceDoc.id,
    });

    await personalModel.permanentlyDelete(workspaceDoc.id);
    await expect(workspaceModel.findById(workspaceDoc.id)).resolves.toMatchObject({
      id: workspaceDoc.id,
    });
  });
});

afterEach(async () => {
  await serverDB.delete(agentDocuments).where(eq(agentDocuments.userId, userId));
  await serverDB.delete(documents).where(eq(documents.userId, userId));
  await serverDB.delete(agents).where(eq(agents.userId, userId));
});
