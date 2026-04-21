// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentDocuments, agents, documents, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import {
  AgentDocumentModel,
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from '../agentDocument';

const userId = 'agent-document-test-user';
const otherUserId = 'other-agent-document-test-user';

const agentId = 'agent-document-test-agent';
const secondAgentId = 'agent-document-test-agent-2';
const otherAgentId = 'other-agent-document-test-agent';

let agentDocumentModel: AgentDocumentModel;
let otherAgentDocumentModel: AgentDocumentModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: secondAgentId, userId },
    { id: otherAgentId, userId: otherUserId },
  ]);

  agentDocumentModel = new AgentDocumentModel(serverDB, userId);
  otherAgentDocumentModel = new AgentDocumentModel(serverDB, otherUserId);
});

describe('AgentDocumentModel', () => {
  describe('associate', () => {
    it('should link an existing document to an agent and return the new id', async () => {
      // Create a document in the documents table directly
      const [doc] = await serverDB
        .insert(documents)
        .values({
          content: 'crawled content',
          fileType: 'article',
          filename: 'page.html',
          source: 'https://example.com',
          sourceType: 'web',
          title: 'Example Page',
          totalCharCount: 15,
          totalLineCount: 1,
          userId,
        })
        .returning();

      const result = await agentDocumentModel.associate({ agentId, documentId: doc!.id });

      expect(result.id).toBeDefined();
      expect(result.id).not.toBe('');

      // Verify the agentDocuments row was created
      const [row] = await serverDB
        .select()
        .from(agentDocuments)
        .where(eq(agentDocuments.id, result.id));

      expect(row).toBeDefined();
      expect(row?.agentId).toBe(agentId);
      expect(row?.documentId).toBe(doc!.id);
      expect(row?.userId).toBe(userId);
      expect(row?.policyLoad).toBe(PolicyLoad.PROGRESSIVE);
    });

    it('should be idempotent (onConflictDoNothing)', async () => {
      const [doc] = await serverDB
        .insert(documents)
        .values({
          content: 'content',
          fileType: 'article',
          filename: 'dup.html',
          source: 'https://example.com/dup',
          sourceType: 'web',
          title: 'Dup Page',
          totalCharCount: 7,
          totalLineCount: 1,
          userId,
        })
        .returning();

      const first = await agentDocumentModel.associate({ agentId, documentId: doc!.id });
      const second = await agentDocumentModel.associate({ agentId, documentId: doc!.id });

      expect(first.id).toBeDefined();
      // Second call should not throw, id may be undefined due to onConflictDoNothing
      expect(second).toBeDefined();
    });

    it('should not create documents row — only the link', async () => {
      const [doc] = await serverDB
        .insert(documents)
        .values({
          content: 'existing',
          fileType: 'article',
          filename: 'existing.html',
          source: 'https://example.com/existing',
          sourceType: 'web',
          title: 'Existing',
          totalCharCount: 8,
          totalLineCount: 1,
          userId,
        })
        .returning();

      const countBefore = await serverDB
        .select()
        .from(documents)
        .where(eq(documents.userId, userId));
      await agentDocumentModel.associate({ agentId, documentId: doc!.id });
      const countAfter = await serverDB
        .select()
        .from(documents)
        .where(eq(documents.userId, userId));

      expect(countAfter.length).toBe(countBefore.length);
    });
  });

  describe('create', () => {
    it('should create an agent document with normalized policy and linked document row', async () => {
      const result = await agentDocumentModel.create(agentId, 'identity.md', 'line1\nline2', {
        loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
        loadRules: { maxTokens: 1024, priority: 2, rule: DocumentLoadRule.ALWAYS },
        metadata: { description: 'Identity policy', domain: 'ops' },
        templateId: 'claw',
      });

      expect(result.agentId).toBe(agentId);
      expect(result.filename).toBe('identity.md');
      expect(result.title).toBe('identity');
      expect(result.content).toBe('line1\nline2');
      expect(result.policy?.context?.position).toBe(DocumentLoadPosition.BEFORE_SYSTEM);
      expect(result.policy?.context?.maxTokens).toBe(1024);
      expect(result.policy?.context?.priority).toBe(2);
      expect(result.policyLoadFormat).toBe(DocumentLoadFormat.RAW);
      expect(result.policyLoadRule).toBe(DocumentLoadRule.ALWAYS);

      const [doc] = await serverDB
        .select()
        .from(documents)
        .where(eq(documents.id, result.documentId));

      expect(doc).toBeDefined();
      expect(doc?.title).toBe('identity');
      expect(doc?.description).toBe('Identity policy');
      expect(doc?.source).toBe(`agent-document://${agentId}/${encodeURIComponent('identity.md')}`);
      expect(doc?.totalCharCount).toBe('line1\nline2'.length);
      expect(doc?.totalLineCount).toBe(2);
    });

    it('should use default policy values when optional args are omitted', async () => {
      const result = await agentDocumentModel.create(agentId, 'quick-note.txt', 'hello');

      expect(result.policy?.context?.position).toBe(DocumentLoadPosition.BEFORE_FIRST_USER);
      expect(result.policy?.context?.rule).toBe(DocumentLoadRule.ALWAYS);
      expect(result.policyLoadFormat).toBe(DocumentLoadFormat.RAW);
      expect(result.policyLoad).toBe(PolicyLoad.PROGRESSIVE);
      expect(result.accessShared).toBe(0);
      expect(result.accessPublic).toBe(0);
    });
  });

  describe('findById and findByFilename', () => {
    it('should isolate records by user', async () => {
      const ownDoc = await agentDocumentModel.create(agentId, 'own.md', 'own content');
      const otherDoc = await otherAgentDocumentModel.create(
        otherAgentId,
        'other.md',
        'other content',
      );

      const ownResult = await agentDocumentModel.findById(ownDoc.id);
      const otherResult = await agentDocumentModel.findById(otherDoc.id);

      expect(ownResult?.id).toBe(ownDoc.id);
      expect(otherResult).toBeUndefined();

      const byFilename = await agentDocumentModel.findByFilename(agentId, 'own.md');
      expect(byFilename?.id).toBe(ownDoc.id);
    });
  });

  describe('update and upsert', () => {
    it('should update content, metadata and policy projections', async () => {
      const created = await agentDocumentModel.create(agentId, 'policy.md', 'old', {
        loadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: { maxTokens: 100, priority: 8 },
        metadata: { description: 'old desc', topic: 'old' },
      });

      await agentDocumentModel.update(created.id, {
        content: 'new\ncontent',
        loadPosition: DocumentLoadPosition.AFTER_KNOWLEDGE,
        loadRules: { maxTokens: 500, priority: 1 },
        metadata: { description: 'new desc', topic: 'new' },
        policy: { context: { policyLoadFormat: DocumentLoadFormat.FILE } },
      });

      const updated = await agentDocumentModel.findById(created.id);
      expect(updated?.content).toBe('new\ncontent');
      expect(updated?.metadata).toMatchObject({ description: 'new desc', topic: 'new' });
      expect(updated?.policy?.context?.position).toBe(DocumentLoadPosition.AFTER_KNOWLEDGE);
      expect(updated?.policy?.context?.maxTokens).toBe(500);
      expect(updated?.policy?.context?.priority).toBe(1);
      expect(updated?.policyLoadFormat).toBe(DocumentLoadFormat.FILE);
      expect(updated?.policyLoadPosition).toBe(DocumentLoadPosition.AFTER_KNOWLEDGE);

      const [updatedDoc] = await serverDB
        .select()
        .from(documents)
        .where(eq(documents.id, created.documentId));

      expect(updatedDoc?.totalCharCount).toBe('new\ncontent'.length);
      expect(updatedDoc?.totalLineCount).toBe(2);
      expect(updatedDoc?.description).toBe('new desc');
    });

    it('should upsert by creating a new document when filename does not exist', async () => {
      const result = await agentDocumentModel.upsert(agentId, 'new-upsert.md', 'fresh', {
        loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
        loadRules: { priority: 5 },
        templateId: 'claw',
      });

      expect(result.filename).toBe('new-upsert.md');
      expect(result.content).toBe('fresh');
      expect(result.templateId).toBe('claw');
      expect(result.policy?.context?.position).toBe(DocumentLoadPosition.BEFORE_SYSTEM);
    });

    it('should upsert by filename and merge metadata on updates', async () => {
      const first = await agentDocumentModel.upsert(agentId, 'policy-upsert.md', 'v1', {
        loadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: { priority: 9 },
        metadata: { a: 1, description: 'v1' },
      });

      const second = await agentDocumentModel.upsert(agentId, 'policy-upsert.md', 'v2', {
        loadRules: { priority: 1, maxTokens: 900 },
        metadata: { b: 2, description: 'v2' },
      });

      expect(second.id).toBe(first.id);
      expect(second.content).toBe('v2');
      expect(second.metadata).toMatchObject({ a: 1, b: 2, description: 'v2' });
      expect(second.policy?.context?.priority).toBe(9);
      expect(second.policy?.context?.maxTokens).toBe(900);
    });
  });

  describe('rename and copy', () => {
    it('should rename and preserve human-readable filename/source', async () => {
      const created = await agentDocumentModel.create(agentId, 'old-name.md', 'hello');

      const renamed = await agentDocumentModel.rename(created.id, 'New Name');

      expect(renamed?.title).toBe('New Name');
      expect(renamed?.filename).toBe('New Name');

      const [doc] = await serverDB
        .select()
        .from(documents)
        .where(eq(documents.id, created.documentId));

      expect(doc?.source).toBe(`agent-document://${agentId}/${encodeURIComponent('New Name')}`);
    });

    it('uses the new title verbatim as filename when renaming', async () => {
      const created = await agentDocumentModel.create(agentId, 'identity.md', 'hello');

      const renamed = await agentDocumentModel.rename(created.id, 'IDENTITY 2');

      expect(renamed?.filename).toBe('IDENTITY 2');
    });

    it('should copy into a new record and keep policy/template metadata', async () => {
      const created = await agentDocumentModel.create(agentId, 'copy-source.md', 'copy me', {
        loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
        loadRules: { maxTokens: 200, priority: 3 },
        metadata: { description: 'source desc', domain: 'A' },
        templateId: 'claw',
      });

      const copied = await agentDocumentModel.copy(created.id, 'Copied Title');

      expect(copied).toBeDefined();
      expect(copied?.id).not.toBe(created.id);
      expect(copied?.documentId).not.toBe(created.documentId);
      expect(copied?.filename).toBe('Copied Title');
      expect(copied?.templateId).toBe('claw');
      expect(copied?.policy?.context?.maxTokens).toBe(200);
      expect(copied?.metadata).toMatchObject({ description: 'source desc', domain: 'A' });
    });

    it('should preserve policyLoad when copying a document', async () => {
      const created = await agentDocumentModel.create(agentId, 'always-doc.md', 'content', {
        policyLoad: PolicyLoad.ALWAYS,
      });

      const copied = await agentDocumentModel.copy(created.id, 'Always Copy');

      expect(copied?.policyLoad).toBe(PolicyLoad.ALWAYS);
    });
  });

  describe('findByAgent and findByTemplate', () => {
    it('should return matched docs with parsed loadRules', async () => {
      await agentDocumentModel.create(agentId, 'a.md', 'A', {
        loadRules: { maxTokens: 100, priority: 2 },
      });
      await agentDocumentModel.create(agentId, 'b.md', 'B', {
        loadRules: { maxTokens: 50, priority: 1 },
      });
      await agentDocumentModel.create(agentId, 'c.md', 'C', {
        loadRules: { priority: 9 },
        templateId: 'claw',
      });
      await agentDocumentModel.create(agentId, 'd.md', 'D', {
        loadRules: { priority: 8 },
        templateId: 'claw',
      });
      await agentDocumentModel.create(secondAgentId, 'e.md', 'E', {
        loadRules: { priority: 7 },
        templateId: 'claw',
      });

      const byAgent = await agentDocumentModel.findByAgent(agentId);
      expect(byAgent).toHaveLength(4);
      expect(byAgent.every((item) => item.agentId === agentId)).toBe(true);
      expect(byAgent[0].loadRules).toBeDefined();

      const byTemplate = await agentDocumentModel.findByTemplate(agentId, 'claw');
      expect(byTemplate).toHaveLength(2);
      expect(byTemplate.every((item) => item.templateId === 'claw')).toBe(true);
    });
  });

  describe('hasByAgent', () => {
    it('should return whether a user has visible documents for the agent', async () => {
      expect(await agentDocumentModel.hasByAgent(agentId)).toBe(false);

      const created = await agentDocumentModel.create(agentId, 'exists.md', 'A');
      await agentDocumentModel.create(secondAgentId, 'other-agent.md', 'B');

      expect(await agentDocumentModel.hasByAgent(agentId)).toBe(true);
      expect(await agentDocumentModel.hasByAgent(secondAgentId)).toBe(true);

      await agentDocumentModel.delete(created.id);

      expect(await agentDocumentModel.hasByAgent(agentId)).toBe(false);
    });

    it('should keep existence checks isolated by user', async () => {
      await otherAgentDocumentModel.create(otherAgentId, 'other-user.md', 'A');

      expect(await agentDocumentModel.hasByAgent(otherAgentId)).toBe(false);
      expect(await otherAgentDocumentModel.hasByAgent(otherAgentId)).toBe(true);
    });
  });

  describe('updateToolLoadRule and loadable queries', () => {
    it('should apply tool load rule and exclude manual docs from loadable results', async () => {
      const alwaysDoc = await agentDocumentModel.create(agentId, 'always.md', 'always', {
        loadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: { priority: 2 },
      });
      const manualDoc = await agentDocumentModel.create(agentId, 'manual.md', 'manual', {
        loadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: { priority: 1 },
      });

      const updated = await agentDocumentModel.updateToolLoadRule(manualDoc.id, {
        keywordMatchMode: 'all',
        keywords: ['urgent', 'risk'],
        maxDocuments: 3,
        maxTokens: 600,
        mode: 'manual',
        pinnedDocumentIds: [alwaysDoc.id],
        policyLoadFormat: 'file',
        priority: 10,
        regexp: '\\burgent\\b',
        rule: DocumentLoadRule.BY_KEYWORDS,
        timeRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T23:59:59.000Z' },
      });

      expect(updated?.policyLoad).toBe(PolicyLoad.DISABLED);
      expect(updated?.policyLoadFormat).toBe(DocumentLoadFormat.FILE);
      expect(updated?.policy?.context?.maxDocuments).toBe(3);
      expect(updated?.policy?.context?.rule).toBe(DocumentLoadRule.BY_KEYWORDS);
      expect(updated?.policy?.context?.keywords).toEqual(['urgent', 'risk']);
      expect(updated?.policy?.context?.keywordMatchMode).toBe('all');
      expect(updated?.policy?.context?.regexp).toBe('\\burgent\\b');
      expect(updated?.policy?.context?.timeRange).toEqual({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-12-31T23:59:59.000Z',
      });
      expect(updated?.policy?.context?.pinnedDocumentIds).toEqual([alwaysDoc.id]);

      const loadable = await agentDocumentModel.getLoadableDocuments(agentId);
      expect(loadable).toHaveLength(1);
      expect(loadable[0].id).toBe(alwaysDoc.id);

      const injectable = await agentDocumentModel.getInjectableDocuments(agentId);
      expect(injectable.map((d) => d.id)).toEqual([alwaysDoc.id]);

      const context = await agentDocumentModel.getAgentContext(agentId);
      expect(context).toContain('--- always.md ---');
      expect(context).not.toContain('--- manual.md ---');
    });

    it('should preserve progressive policyLoad when updating load rule without mode', async () => {
      const doc = await agentDocumentModel.create(agentId, 'progressive.md', 'content');
      expect(doc.policyLoad).toBe(PolicyLoad.PROGRESSIVE);

      const updated = await agentDocumentModel.updateToolLoadRule(doc.id, {
        rule: 'by-keywords',
        keywords: ['test'],
      });

      expect(updated?.policyLoad).toBe(PolicyLoad.PROGRESSIVE);
      expect(updated?.policy?.context?.keywords).toEqual(['test']);
      expect(updated?.policyLoadRule).toBe(DocumentLoadRule.BY_KEYWORDS);
    });

    it('should group docs by position and sort by priority ascending', async () => {
      await agentDocumentModel.create(agentId, 'p2.md', 'p2', {
        loadPosition: DocumentLoadPosition.BEFORE_KNOWLEDGE,
        loadRules: { priority: 2 },
      });
      await agentDocumentModel.create(agentId, 'p1.md', 'p1', {
        loadPosition: DocumentLoadPosition.BEFORE_KNOWLEDGE,
        loadRules: { priority: 1 },
      });

      const grouped = await agentDocumentModel.getDocumentsByPosition(agentId);
      const docsAtPosition = grouped.get(DocumentLoadPosition.BEFORE_KNOWLEDGE) || [];

      expect(docsAtPosition).toHaveLength(2);
      expect(docsAtPosition[0].filename).toBe('p1.md');
      expect(docsAtPosition[1].filename).toBe('p2.md');
    });
  });

  describe('delete', () => {
    it('should soft delete a single document while preserving linked documents row', async () => {
      const created = await agentDocumentModel.create(agentId, 'delete-me.md', 'delete me');

      await agentDocumentModel.delete(created.id, 'cleanup');

      const visible = await agentDocumentModel.findById(created.id);
      expect(visible).toBeUndefined();

      const [rawAgentDoc] = await serverDB
        .select()
        .from(agentDocuments)
        .where(eq(agentDocuments.id, created.id));

      expect(rawAgentDoc?.deletedAt).toBeInstanceOf(Date);
      expect(rawAgentDoc?.deletedByUserId).toBe(userId);
      expect(rawAgentDoc?.deletedByAgentId).toBeNull();
      expect(rawAgentDoc?.deleteReason).toBe('cleanup');
      expect(rawAgentDoc?.policyLoad).toBe(PolicyLoad.DISABLED);

      const [rawDoc] = await serverDB
        .select()
        .from(documents)
        .where(eq(documents.id, created.documentId));

      expect(rawDoc).toBeDefined();
    });

    it('should return empty string from getAgentContext when no loadable docs exist', async () => {
      const context = await agentDocumentModel.getAgentContext(agentId);
      expect(context).toBe('');
    });

    it('should soft delete by agent and by template', async () => {
      const templateDoc = await agentDocumentModel.create(agentId, 'template-a.md', 'A', {
        templateId: 'claw',
      });
      const otherTemplateDoc = await agentDocumentModel.create(agentId, 'template-b.md', 'B', {
        templateId: 'other',
      });
      const secondAgentDoc = await agentDocumentModel.create(secondAgentId, 'agent-2.md', 'C');

      await agentDocumentModel.deleteByTemplate(agentId, 'claw', 'template cleanup');

      const clawVisible = await agentDocumentModel.findById(templateDoc.id);
      const otherTemplateVisible = await agentDocumentModel.findById(otherTemplateDoc.id);
      expect(clawVisible).toBeUndefined();
      expect(otherTemplateVisible).toBeDefined();

      await agentDocumentModel.deleteByAgent(secondAgentId, 'agent cleanup');
      const secondAgentVisible = await agentDocumentModel.findById(secondAgentDoc.id);
      expect(secondAgentVisible).toBeUndefined();
      const [secondAgentRow] = await serverDB
        .select()
        .from(agentDocuments)
        .where(and(eq(agentDocuments.id, secondAgentDoc.id), eq(agentDocuments.userId, userId)));
      expect(secondAgentRow?.deletedByAgentId).toBe(secondAgentId);
      expect(secondAgentRow?.deletedByUserId).toBeNull();

      const [otherTemplateRow] = await serverDB
        .select()
        .from(agentDocuments)
        .where(and(eq(agentDocuments.id, otherTemplateDoc.id), eq(agentDocuments.userId, userId)));
      expect(otherTemplateRow?.deletedAt).toBeNull();
    });
  });
});
