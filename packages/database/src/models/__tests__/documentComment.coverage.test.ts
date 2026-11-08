// @vitest-environment node
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documentComments, documents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentCommentModel } from '../documentComment';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const authorId = 'dccov-author';
const workspaceId = 'dccov-workspace';
const otherWorkspaceId = 'dccov-other-workspace';
const documentId = 'dccov-document';

const authorModel = new DocumentCommentModel(serverDB, authorId, workspaceId);

/** Every unfiltered `count(*)` over document_comments comes back without a row. */
const emptyCountDB = () =>
  createProxyTestDB(serverDB, (query, result) =>
    /^select count\(\*\) from "document_comments"/.test(query) ? [] : result.rows,
  );

const insertComment = async (values: Partial<typeof documentComments.$inferInsert>) => {
  const [row] = await serverDB
    .insert(documentComments)
    .values({
      authorUserId: authorId,
      clientId: crypto.randomUUID(),
      content: 'comment',
      documentId,
      workspaceId,
      ...values,
    })
    .returning();
  return row;
};

const cleanup = async () => {
  // documents and document_comments cascade from the owning user / workspace.
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]));
  await serverDB.delete(users).where(eq(users.id, authorId));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: authorId });
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'dccov', primaryOwnerId: authorId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'dccov other', primaryOwnerId: authorId, slug: otherWorkspaceId },
  ]);
  await serverDB.insert(documents).values({
    fileType: 'custom',
    id: documentId,
    source: documentId,
    sourceType: 'api',
    totalCharCount: 0,
    totalLineCount: 0,
    userId: authorId,
    workspaceId,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

describe('DocumentCommentModel coverage edges', () => {
  describe('cursor decoding', () => {
    it('treats a cursor without a usable separator as the first page', async () => {
      const first = await insertComment({});
      const second = await insertComment({});

      for (const cursor of ['no-separator', `|${first.id}`]) {
        const result = await authorModel.listThreads({ cursor, documentId });
        expect(result.items.map(({ root }) => root.id).sort()).toEqual(
          [first.id, second.id].sort(),
        );
        expect(result.nextCursor).toBeNull();
      }
    });

    it('treats a cursor with an unparsable timestamp or empty id as the first page', async () => {
      const root = await insertComment({});
      const reply = await insertComment({ parentCommentId: root.id });

      for (const cursor of [`not-a-date|${reply.id}`, '2026-01-01T00:00:00Z|']) {
        const result = await authorModel.listReplies({ cursor, rootCommentId: root.id });
        expect(result.items.map(({ id }) => id)).toEqual([reply.id]);
        // A decoded cursor drops the total; an ignored one keeps the first-page total.
        expect(result.total).toBe(1);
      }
    });
  });

  describe('create', () => {
    it('fails when the idempotency key conflicts with a row outside the current workspace', async () => {
      // A comment left behind with the old workspace stamp (e.g. after the document
      // moved) still owns the (document, author, clientId) key.
      const stale = await insertComment({ clientId: 'moved', workspaceId: otherWorkspaceId });

      await expect(
        authorModel.create({ clientId: 'moved', content: 'retry', documentId }),
      ).rejects.toThrow('Failed to create document comment');

      const rows = await serverDB
        .select()
        .from(documentComments)
        .where(eq(documentComments.documentId, documentId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        content: 'comment',
        id: stale.id,
        workspaceId: otherWorkspaceId,
      });
    });
  });

  describe('update', () => {
    it('updates only editorData when content is omitted', async () => {
      const comment = await insertComment({ content: 'keep me' });
      const editorData = { root: { children: [], type: 'root' } } as any;

      const result = await authorModel.update(comment.id, { editorData });

      expect(result?.addedMentionUserIds).toEqual([]);
      expect(result?.comment).toMatchObject({ content: 'keep me', editorData });
    });
  });

  describe('delete', () => {
    it('refuses a comment whose thread root is not a live root in this workspace', async () => {
      const root = await insertComment({});
      const middle = await insertComment({ parentCommentId: root.id });
      // A legacy nested row: its parent is itself a reply, so no thread root can be locked.
      const nested = await insertComment({ parentCommentId: middle.id });

      expect(await authorModel.delete(nested.id)).toBe(false);

      const [stillThere] = await serverDB
        .select()
        .from(documentComments)
        .where(eq(documentComments.id, nested.id));
      expect(stillThere).toMatchObject({ deletedAt: null, id: nested.id });
    });

    it('refuses to delete an already tombstoned comment again', async () => {
      const root = await insertComment({});
      await insertComment({ parentCommentId: root.id });

      expect(await authorModel.delete(root.id)).toBe('soft');
      expect(await authorModel.delete(root.id)).toBe(false);

      const [tombstone] = await serverDB
        .select()
        .from(documentComments)
        .where(eq(documentComments.id, root.id));
      expect(tombstone.deletedAt).toBeInstanceOf(Date);
    });

    it('keeps a tombstoned root while other replies remain under it', async () => {
      const root = await insertComment({});
      const reply = await insertComment({ parentCommentId: root.id });
      const sibling = await insertComment({ parentCommentId: root.id });
      expect(await authorModel.delete(root.id)).toBe('soft');

      expect(await authorModel.delete(reply.id)).toBe('hard');

      const rows = await serverDB
        .select({ deletedAt: documentComments.deletedAt, id: documentComments.id })
        .from(documentComments)
        .where(inArray(documentComments.id, [root.id, reply.id, sibling.id]));
      expect(rows.map(({ id }) => id).sort()).toEqual([root.id, sibling.id].sort());
      expect(rows.find(({ id }) => id === root.id)?.deletedAt).toBeInstanceOf(Date);
    });

    it('treats reply and sibling counts that return no row as zero', async () => {
      const root = await insertComment({});
      const reply = await insertComment({ parentCommentId: root.id });
      await serverDB
        .update(documentComments)
        .set({ content: '', deletedAt: new Date() })
        .where(eq(documentComments.id, root.id));

      // Run the transaction body on a driver seam whose count(*) aggregates return no row.
      const proxyDB = emptyCountDB();
      vi.spyOn(serverDB, 'transaction').mockImplementation(((fn: (tx: unknown) => unknown) =>
        fn(proxyDB)) as unknown as LobeChatDatabase['transaction']);

      expect(await authorModel.delete(reply.id)).toBe('hard');

      // Zero siblings left under the tombstoned root, so it is reaped too.
      const rows = await serverDB
        .select({ id: documentComments.id })
        .from(documentComments)
        .where(inArray(documentComments.id, [root.id, reply.id]));
      expect(rows).toEqual([]);
    });
  });

  describe('aggregate fallbacks', () => {
    it('reports zero when the live reply and summary counts return no row', async () => {
      const root = await insertComment({});
      await insertComment({ parentCommentId: root.id });
      const proxyModel = new DocumentCommentModel(emptyCountDB(), authorId, workspaceId);

      expect(await proxyModel.countLiveReplies(root.id)).toBe(0);
      expect(await proxyModel.summary(documentId)).toEqual({ total: 0 });
    });
  });

  describe('listThreads', () => {
    it('skips the reply count query when the page has no roots', async () => {
      const selectSpy = vi.spyOn(serverDB, 'select');

      const result = await authorModel.listThreads({ documentId });

      expect(result).toEqual({ items: [], nextCursor: null });
      expect(selectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('listAnchors', () => {
    it('drops a root whose anchor is a JSON null rather than SQL NULL', async () => {
      const anchor = { quote: 'hello' } as any;
      const anchored = await insertComment({ selectionAnchor: anchor });
      await insertComment({ selectionAnchor: sql`'null'::jsonb` as any });

      expect(await authorModel.listAnchors(documentId)).toEqual([
        { id: anchored.id, selectionAnchor: anchor },
      ]);
    });
  });
});
