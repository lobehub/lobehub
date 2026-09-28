// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { KnowledgeRepo } from '../../repositories/knowledge';
import { agentDocuments, agents, documents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentDocumentModel } from '../agentDocuments';
import { FileModel } from '../file';

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
  /** @example A shared document and upload survive until their final binding is deleted. */
  it('returns backing files for cleanup only after deleting the final binding', async () => {
    // ROOT CAUSE:
    // Deleting a binding also deleted its document, even when another agent still used it.
    // Keep shared documents; return deleted documents' file IDs for safe storage cleanup.
    const model = new AgentDocumentModel(serverDB, userId, workspaceId);
    const fileModel = new FileModel(serverDB, userId, workspaceId);
    const { id: fileId } = await fileModel.create({
      fileType: 'application/pdf',
      name: 'shared.pdf',
      size: 100,
      source: FileSource.AgentDocument,
      url: 'files/shared.pdf',
      visibility: 'public',
    });
    const document = await model.create('workspace-agent-document-agent', 'shared.pdf', '', {
      fileId,
      fileType: 'application/pdf',
      sourceType: 'file',
    });
    await serverDB.insert(agents).values({ id: 'second-agent', userId, workspaceId });
    const second = await model.associate({
      agentId: 'second-agent',
      documentId: document.documentId,
    });

    await model.delete(document.id);
    await fileModel.deleteUnreferenced(fileId);
    /** @example Soft deletion preserves recoverable original bytes. */
    expect(await fileModel.findById(fileId)).toBeDefined();
    /** @example Deleting the first binding leaves the shared document in place. */
    expect(await model.permanentlyDelete(document.id)).toEqual([]);
    /** @example The other agent can still open the document. */
    expect(await model.findById(second.id)).toBeDefined();
    /** @example The final binding returns its backing file for reclamation. */
    expect(await model.permanentlyDelete(second.id)).toEqual([fileId]);
    await fileModel.deleteUnreferenced(fileId, { source: FileSource.AgentDocument });
    /** @example The now-unreferenced upload row is reclaimed. */
    expect(await fileModel.findById(fileId)).toBeUndefined();
  });

  /** @example A new agent document is public in its workspace but absent from Resources. */
  it('creates public agent documents without adding them to the resource library', async () => {
    const memberId = 'agent-document-other-member';
    await serverDB.insert(users).values({ id: memberId });
    const model = new AgentDocumentModel(serverDB, userId, workspaceId);
    const document = await model.create('workspace-agent-document-agent', 'shared.md', '# Shared');
    const [stored] = await serverDB
      .select({ visibility: documents.visibility })
      .from(documents)
      .where(eq(documents.id, document.documentId));

    /** @example The default is explicitly public, so members share the same agent resource. */
    expect(stored?.visibility).toBe('public');
    /** @example Another workspace member can read the bound agent document. */
    expect(
      await new AgentDocumentModel(serverDB, memberId, workspaceId).findById(document.id),
    ).toMatchObject({ content: '# Shared' });
    /** @example The agent source is excluded from ordinary resource browsing. */
    expect(await new KnowledgeRepo(serverDB, memberId, workspaceId).query()).toEqual([]);
  });

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
