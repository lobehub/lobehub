// @vitest-environment node
// Defensive guards of `AgentDocumentModel` against a real database: missing
// rows, empty inputs, nullable document columns, falsy policy projections and
// bindings that exist outside the caller's scope.
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentDocuments, agents, documents, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentDocumentModel, DocumentLoadPosition, PolicyLoad } from '../agentDocument';

const userId = 'agent-document-guards-user';
const agentId = 'agent-document-guards-agent';
const otherAgentId = 'agent-document-guards-agent-2';
const workspaceId = 'agent-document-guards-ws';
// agent_documents.id is a uuid column, so a missing binding needs a well-formed id.
const missingBindingId = '00000000-0000-4000-8000-000000000000';

const serverDB: LobeChatDatabase = await getTestDB();
let model: AgentDocumentModel;

const cleanup = async () => {
  // Users cascade to agents, documents, agent_documents and the owned workspace.
  await serverDB.delete(users).where(eq(users.id, userId));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: otherAgentId, userId },
  ]);
  model = new AgentDocumentModel(serverDB, userId);
});

afterEach(cleanup);

/** Inserts a bare documents row whose nullable columns are all left null. */
const insertBareDocument = async (overrides: Partial<typeof documents.$inferInsert> = {}) => {
  const [doc] = await serverDB
    .insert(documents)
    .values({
      fileType: 'custom/document',
      source: 'test://bare',
      sourceType: 'agent',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
      ...overrides,
    })
    .returning();
  return doc!;
};

const bindingRow = async (id: string) => {
  const [row] = await serverDB.select().from(agentDocuments).where(eq(agentDocuments.id, id));
  return row;
};

describe('AgentDocumentModel guards', () => {
  describe('associate', () => {
    it('returns an empty id when the source document does not exist', async () => {
      const result = await model.associate({ agentId, documentId: 'missing-document-id' });

      expect(result).toEqual({ id: '' });
      const rows = await serverDB
        .select()
        .from(agentDocuments)
        .where(eq(agentDocuments.agentId, agentId));
      expect(rows).toHaveLength(0);
    });

    it('returns an empty id when the conflicting binding lives outside the personal scope', async () => {
      await serverDB
        .insert(workspaces)
        .values({ id: workspaceId, name: 'Guards', primaryOwnerId: userId, slug: workspaceId });
      const doc = await insertBareDocument({ filename: 'shared.md' });
      // Same (agent, document, user) key, but bound in a workspace, so the
      // personal-mode insert conflicts and the follow-up lookup cannot see it.
      const [workspaceBinding] = await serverDB
        .insert(agentDocuments)
        .values({ agentId: otherAgentId, documentId: doc.id, userId, workspaceId })
        .returning();

      const result = await model.associate({ agentId: otherAgentId, documentId: doc.id });

      expect(result).toEqual({ id: '' });
      const rows = await serverDB
        .select()
        .from(agentDocuments)
        .where(eq(agentDocuments.documentId, doc.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: workspaceBinding!.id, workspaceId });
    });
  });

  describe('falsy policy projections', () => {
    const blankContext = { context: { policyLoadFormat: '', position: '', rule: '' } } as any;

    it('falls back to default projections when create receives empty policy fields', async () => {
      const created = await model.create(agentId, 'blank-policy.md', 'body', {
        policy: blankContext,
      });

      const row = await bindingRow(created.id);
      expect(row).toMatchObject({
        policyLoadFormat: 'raw',
        policyLoadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
        policyLoadRule: 'always',
      });
      expect(created.policyLoadFormat).toBe('raw');
    });

    it('falls back to default projections when update merges empty policy fields', async () => {
      const created = await model.create(agentId, 'update-policy.md', 'body', {
        loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
        loadRules: { rule: 'by-keywords' as any },
      });

      await model.update(created.id, { policy: blankContext });

      const row = await bindingRow(created.id);
      expect(row).toMatchObject({
        policyLoadFormat: 'raw',
        policyLoadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
        policyLoadRule: 'always',
      });
    });
  });

  describe('convertAgentDocumentToSkillIndex', () => {
    it('returns undefined and writes nothing when the binding does not exist', async () => {
      const result = await model.convertAgentDocumentToSkillIndex({
        agentDocumentId: missingBindingId,
        content: '# skill',
        filename: 'SKILL.md',
        metadata: {},
        parentId: 'missing-parent',
        source: 'test://skill',
        sourceType: 'agent',
        title: 'Skill',
      });

      expect(result).toBeUndefined();
      const docs = await serverDB.select().from(documents).where(eq(documents.userId, userId));
      expect(docs).toHaveLength(0);
    });
  });

  describe('findByIdWithOptions', () => {
    it('only returns a soft-deleted binding when deleted rows are requested', async () => {
      const created = await model.create(agentId, 'deleted.md', 'gone');
      await model.delete(created.id, 'cleanup');

      expect(await model.findByIdWithOptions(created.id)).toBeUndefined();
      const found = await model.findByIdWithOptions(created.id, { includeDeleted: true });
      expect(found?.id).toBe(created.id);
      expect(found?.deleteReason).toBe('cleanup');
    });
  });

  describe('lifecycle on missing roots', () => {
    it('leaves existing bindings untouched when the subtree root is missing', async () => {
      const live = await model.create(agentId, 'live.md', 'live');
      const deleted = await model.create(agentId, 'trashed.md', 'trashed');
      await model.delete(deleted.id);

      await model.deleteSubtreeByDocumentId(agentId, 'missing-document-id');
      await model.restoreSubtreeByDocumentId(agentId, 'missing-document-id');
      await model.restore(missingBindingId);

      expect((await bindingRow(live.id))?.deletedAt).toBeNull();
      expect((await bindingRow(deleted.id))?.deletedAt).toBeInstanceOf(Date);
      expect(await model.listSubtreeByDocumentId(agentId, 'missing-document-id')).toEqual([]);
    });
  });

  describe('getAgentContext', () => {
    it('skips loadable documents without content', async () => {
      await model.create(agentId, 'empty.md', '', { policyLoad: PolicyLoad.ALWAYS });
      await model.create(agentId, 'filled.md', 'filled body', { policyLoad: PolicyLoad.ALWAYS });

      const context = await model.getAgentContext(agentId);

      expect(context).toBe('--- filled.md ---\nfilled body');
    });
  });

  describe('rows with null document columns', () => {
    it('maps null filename, title, content and policy to stable defaults', async () => {
      const doc = await insertBareDocument();
      const [binding] = await serverDB
        .insert(agentDocuments)
        .values({ agentId, documentId: doc.id, policy: null, userId })
        .returning();

      const found = await model.findById(binding!.id);
      expect(found).toMatchObject({
        content: '',
        filename: '',
        policy: null,
        source: 'test://bare',
        title: '',
      });

      const [listed] = await model.listByAgent(agentId);
      expect(listed).toMatchObject({ filename: '', loadPosition: undefined, title: '' });

      const [context] = await model.findContextByAgent(agentId);
      expect(context).toMatchObject({ content: '', filename: '', policy: null, title: '' });
    });

    it('falls back from a null title to the filename in context rows', async () => {
      const doc = await insertBareDocument({ filename: 'only-filename.md' });
      await serverDB.insert(agentDocuments).values({ agentId, documentId: doc.id, userId });

      const [context] = await model.findContextByAgent(agentId);

      expect(context?.title).toBe('only-filename.md');
    });
  });

  describe('empty id lists', () => {
    it('short-circuits document id lookups without querying', async () => {
      await model.create(agentId, 'present.md', 'present');

      expect(await model.findByDocumentIds(agentId, [])).toEqual([]);
      expect(await model.listByDocumentIds(agentId, [])).toEqual([]);
    });
  });

  describe('parent-scoped tree queries', () => {
    const seedTree = async () => {
      const folder = await model.create(agentId, 'folder', '', { fileType: 'custom/folder' });
      const first = await model.create(agentId, 'a.md', 'a', { parentId: folder.documentId });
      const second = await model.create(agentId, 'b.md', 'b', { parentId: folder.documentId });
      const third = await model.create(agentId, 'c.md', 'c', { parentId: folder.documentId });
      await model.create(agentId, 'root.md', 'root');
      return { first, folder, second, third };
    };

    it('lists only the children of the requested parent', async () => {
      const { folder } = await seedTree();

      const children = await model.listByAgent(agentId, { parentId: folder.documentId });

      expect(children.map((item) => item.filename).sort()).toEqual(['a.md', 'b.md', 'c.md']);
    });

    it('finds a child by parent and filename, and misses an absent one', async () => {
      const { folder, second } = await seedTree();

      const found = await model.findByParentAndFilename(agentId, folder.documentId, 'b.md');
      expect(found?.id).toBe(second.id);

      expect(
        await model.findByParentAndFilename(agentId, folder.documentId, 'root.md'),
      ).toBeUndefined();
      expect((await model.findByParentAndFilename(agentId, null, 'root.md'))?.filename).toBe(
        'root.md',
      );
      expect(await model.findByParentAndFilename(agentId, null, 'b.md')).toBeUndefined();
    });

    it('pages a parent with offset cursors and ignores invalid cursors', async () => {
      const { first, folder, second, third } = await seedTree();
      const ids = (docs: { id: string }[]) => docs.map((doc) => doc.id);

      expect(ids(await model.listByParent(agentId, folder.documentId, { cursor: '1' }))).toEqual([
        second.id,
        third.id,
      ]);
      expect(
        ids(await model.listByParent(agentId, folder.documentId, { cursor: '1', limit: 1 })),
      ).toEqual([second.id]);
      expect(
        (await model.listByParent(agentId, null, { cursor: '1' })).map((doc) => doc.filename),
      ).toEqual(['root.md']);
      for (const cursor of ['not-a-number', '-2', '0']) {
        expect(ids(await model.listByParent(agentId, folder.documentId, { cursor }))).toEqual([
          first.id,
          second.id,
          third.id,
        ]);
      }
    });
  });

  describe('skill metadata descriptions', () => {
    it('ignores skill metadata without a usable frontmatter description', async () => {
      const noFrontmatter = await model.create(agentId, 'skill-a.md', 'a', {
        metadata: { skill: { name: 'a' } },
      });
      const nonStringDescription = await model.create(agentId, 'skill-b.md', 'b', {
        metadata: { skill: { frontmatter: { description: 42 } } },
      });
      const withDescription = await model.create(agentId, 'skill-c.md', 'c', {
        metadata: { skill: { frontmatter: { description: 'from frontmatter' } } },
      });

      const rows = await serverDB
        .select({ description: documents.description, id: documents.id })
        .from(documents)
        .where(
          inArray(documents.id, [
            noFrontmatter.documentId,
            nonStringDescription.documentId,
            withDescription.documentId,
          ]),
        );
      const byId = new Map(rows.map((row) => [row.id, row.description]));

      expect(byId.get(noFrontmatter.documentId)).toBeNull();
      expect(byId.get(nonStringDescription.documentId)).toBeNull();
      expect(byId.get(withDescription.documentId)).toBe('from frontmatter');
    });
  });

  describe('copy', () => {
    it('defaults the load position when copying a binding without a policy', async () => {
      const doc = await insertBareDocument({ content: 'associated', filename: 'assoc.md' });
      const { id } = await model.associate({ agentId, documentId: doc.id });
      expect((await bindingRow(id))?.policy).toBeNull();

      const copied = await model.copy(id, 'Associated Copy');

      expect(copied).toBeDefined();
      expect(copied?.id).not.toBe(id);
      expect(copied?.policyLoadPosition).toBe(DocumentLoadPosition.BEFORE_FIRST_USER);
      expect(copied?.policy?.context?.position).toBe(DocumentLoadPosition.BEFORE_FIRST_USER);
      const [copiedRow] = await serverDB
        .select()
        .from(agentDocuments)
        .where(and(eq(agentDocuments.id, copied!.id), eq(agentDocuments.userId, userId)));
      expect(copiedRow?.policyLoadPosition).toBe(DocumentLoadPosition.BEFORE_FIRST_USER);
    });
  });
});
