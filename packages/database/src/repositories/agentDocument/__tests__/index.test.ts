// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { PolicyLoad } from '../../../models/agentDocuments/types';
import { agentDocuments, agents, documents, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentDocumentRepository } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-document-repository-user';
const agentId = 'agent-document-repository-agent';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, title: 'Agent', userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentDocumentRepository', () => {
  it('creates the document row and its binding together', async () => {
    const repo = new AgentDocumentRepository(serverDB, userId);

    const created = await repo.create(agentId, 'notes.md', '# Notes');

    const [binding] = await serverDB
      .select()
      .from(agentDocuments)
      .where(eq(agentDocuments.id, created.id));
    const [document] = await serverDB
      .select()
      .from(documents)
      .where(eq(documents.id, created.documentId));

    expect(binding?.documentId).toBe(document?.id);
    expect(document?.content).toBe('# Notes');
  });

  it('rolls back the document row when the binding insert fails', async () => {
    const repo = new AgentDocumentRepository(serverDB, userId);

    await expect(repo.create('missing-agent', 'orphan.md', 'orphan')).rejects.toThrow();

    const orphans = await serverDB
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.filename, 'orphan.md'));
    expect(orphans).toEqual([]);
  });

  it('updates the backing document and binding policy in one call', async () => {
    const repo = new AgentDocumentRepository(serverDB, userId);
    const created = await repo.create(agentId, 'rules.md', 'old');

    await repo.update(created.id, { content: 'new', policyLoad: PolicyLoad.DISABLED });

    const [row] = await serverDB
      .select({ content: documents.content, policyLoad: agentDocuments.policyLoad })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(eq(agentDocuments.id, created.id));
    expect(row).toEqual({ content: 'new', policyLoad: 'disabled' });
  });

  it('converts a binding into a skill index while keeping both ids', async () => {
    const repo = new AgentDocumentRepository(serverDB, userId);
    const bundle = await repo.create(agentId, 'my-skill', '');
    const doc = await repo.create(agentId, 'draft.md', 'draft');

    const converted = await repo.convertToSkillIndex({
      agentDocumentId: doc.id,
      content: 'skill body',
      filename: 'SKILL.md',
      metadata: {},
      parentId: bundle.documentId,
      source: 'agent-skill://my-skill/SKILL.md',
      sourceType: 'agent',
      title: 'My Skill',
    });

    expect(converted).toMatchObject({
      documentId: doc.documentId,
      fileType: 'skills/index',
      filename: 'SKILL.md',
      id: doc.id,
      templateId: 'agent-skill',
    });
  });

  it('permanently deletes a subtree and returns no files for file-less documents', async () => {
    const repo = new AgentDocumentRepository(serverDB, userId);
    const folder = await repo.create(agentId, 'folder', '');
    const child = await repo.create(agentId, 'child.md', 'child', {
      parentId: folder.documentId,
    });

    expect(await repo.permanentlyDeleteSubtree(agentId, folder.documentId)).toEqual([]);

    const remaining = await serverDB
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, child.documentId));
    expect(remaining).toEqual([]);
  });
});
