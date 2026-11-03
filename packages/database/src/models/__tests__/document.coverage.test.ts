// @vitest-environment node
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewDocument } from '../../schemas';
import { documents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'doccov-user';
const targetUserId = 'doccov-target-user';
const workspaceId = 'doccov-workspace';

const documentModel = new DocumentModel(serverDB, userId);

const cleanup = async () => {
  // documents / workspaces cascade from their owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId, targetUserId]));
};

const insertDocument = async (params: Partial<NewDocument> & { id: string }) => {
  const [row] = await serverDB
    .insert(documents)
    .values({
      content: `content of ${params.id}`,
      fileType: 'custom/document',
      source: 'doccov',
      sourceType: 'api',
      title: params.id,
      totalCharCount: 1,
      totalLineCount: 1,
      userId,
      ...params,
    })
    .returning();
  return row;
};

const listOwnedBy = (ownerId: string) =>
  serverDB
    .select()
    .from(documents)
    .where(and(eq(documents.userId, ownerId), isNull(documents.workspaceId)));

describe('DocumentModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }, { id: targetUserId }]);
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'doccov workspace',
      primaryOwnerId: userId,
      slug: 'doccov-workspace',
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  describe('subtreeHasForeignRows', () => {
    it('flags a visible teammate document inside the subtree without querying further', async () => {
      await insertDocument({ id: 'doccov-ws-root', slug: null, visibility: 'public', workspaceId });
      await insertDocument({
        id: 'doccov-ws-teammate',
        parentId: 'doccov-ws-root',
        slug: null,
        userId: targetUserId,
        visibility: 'public',
        workspaceId,
      });
      const workspaceModel = new DocumentModel(serverDB, userId, workspaceId);

      await expect(workspaceModel.subtreeHasForeignRows('doccov-ws-root')).resolves.toBe(true);
      await expect(workspaceModel.subtreeHasForeignRows('doccov-ws-teammate')).resolves.toBe(true);
    });
  });

  describe('transferTo', () => {
    it('renames a slug that is already taken in the target scope', async () => {
      await insertDocument({ id: 'doccov-taken', slug: 'doccov-slug', userId: targetUserId });
      await insertDocument({ id: 'doccov-moving', slug: 'doccov-slug' });

      await expect(documentModel.transferTo('doccov-moving', null, targetUserId)).resolves.toEqual({
        documentIds: ['doccov-moving'],
      });

      const moved = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'doccov-moving'),
      });
      expect(moved).toMatchObject({ slug: 'doccov-slug-1', userId: targetUserId });
      const untouched = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'doccov-taken'),
      });
      expect(untouched?.slug).toBe('doccov-slug');
    });
  });

  describe('transferTo visibility', () => {
    it('applies the requested visibility when landing in a workspace', async () => {
      await insertDocument({ id: 'doccov-to-ws', slug: null });

      await documentModel.transferTo('doccov-to-ws', workspaceId, userId, 'public');

      const moved = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'doccov-to-ws'),
      });
      expect(moved).toMatchObject({ userId, visibility: 'public', workspaceId });
    });
  });

  describe('copyToWorkspace', () => {
    it('applies the requested visibility when copying into a workspace', async () => {
      await insertDocument({ id: 'doccov-copy-public', slug: null });

      const { rootId } = await documentModel.copyToWorkspace(
        'doccov-copy-public',
        workspaceId,
        userId,
        'public',
      );

      const clone = await serverDB.query.documents.findFirst({ where: eq(documents.id, rootId) });
      expect(clone).toMatchObject({ userId, visibility: 'public', workspaceId });
    });

    it('copies a document without a slug and keeps the clone slug-less', async () => {
      await insertDocument({ id: 'doccov-no-slug', slug: null });

      const { rootId } = await documentModel.copyToWorkspace('doccov-no-slug', null, targetUserId);

      const clone = await serverDB.query.documents.findFirst({ where: eq(documents.id, rootId) });
      expect(clone).toMatchObject({
        metadata: { duplicatedFrom: 'doccov-no-slug' },
        slug: null,
        userId: targetUserId,
      });
    });

    it('falls back to a timestamp suffix once slug-1 … slug-99 are all taken', async () => {
      await serverDB.insert(documents).values(
        Array.from({ length: 100 }, (_, i) => ({
          content: '',
          fileType: 'custom/document',
          id: `doccov-busy-${i}`,
          slug: i === 0 ? 'doccov-busy' : `doccov-busy-${i}`,
          source: 'doccov',
          sourceType: 'api' as const,
          totalCharCount: 0,
          totalLineCount: 0,
          userId: targetUserId,
        })),
      );
      await insertDocument({ id: 'doccov-busy-source', slug: 'doccov-busy' });

      const { rootId } = await documentModel.copyToWorkspace(
        'doccov-busy-source',
        null,
        targetUserId,
      );

      const clone = await serverDB.query.documents.findFirst({ where: eq(documents.id, rootId) });
      expect(clone?.slug).toMatch(/^doccov-busy-\d{13}$/);
      expect(await listOwnedBy(targetUserId)).toHaveLength(101);
    });

    it('clones each document once when a concurrent move makes the subtree read it twice', async () => {
      // root ─┬─ branch ── leaf
      //       └─ mover            (mover is re-parented under leaf mid-read)
      await insertDocument({ id: 'doccov-root', slug: null });
      await insertDocument({ id: 'doccov-branch', parentId: 'doccov-root', slug: null });
      await insertDocument({ id: 'doccov-mover', parentId: 'doccov-root', slug: null });
      await insertDocument({ id: 'doccov-leaf', parentId: 'doccov-branch', slug: null });

      // Under READ COMMITTED each level of the subtree walk is its own statement, so a
      // concurrent re-parent that commits between two levels makes the walk return the
      // moved row twice — once under its old parent and once under its new one. Replay
      // that by moving the row inside the copy transaction right after the second level
      // has been read.
      const transaction = serverDB.transaction.bind(serverDB);
      vi.spyOn(serverDB, 'transaction').mockImplementationOnce(((
        callback: (trx: LobeChatDatabase) => Promise<unknown>,
      ) =>
        transaction(async (trx) => {
          const tx = trx as unknown as LobeChatDatabase;
          const findMany = tx.query.documents.findMany.bind(tx.query.documents);
          vi.spyOn(tx.query.documents, 'findMany')
            .mockImplementationOnce(findMany)
            .mockImplementationOnce(((config: Parameters<typeof findMany>[0]) =>
              findMany(config).then(async (rows) => {
                await tx
                  .update(documents)
                  .set({ parentId: 'doccov-leaf' })
                  .where(eq(documents.id, 'doccov-mover'));
                return rows;
              })) as typeof findMany);
          return callback(tx);
        })) as unknown as LobeChatDatabase['transaction']);

      const { rootId } = await documentModel.copyToWorkspace('doccov-root', null, targetUserId);

      const clones = await listOwnedBy(targetUserId);
      expect(clones.map((doc) => doc.metadata?.duplicatedFrom).sort()).toEqual([
        'doccov-branch',
        'doccov-leaf',
        'doccov-mover',
        'doccov-root',
      ]);
      const byOrigin = new Map(clones.map((doc) => [doc.metadata?.duplicatedFrom, doc]));
      expect(byOrigin.get('doccov-root')?.id).toBe(rootId);
      expect(byOrigin.get('doccov-root')?.parentId).toBeNull();
      expect(byOrigin.get('doccov-branch')?.parentId).toBe(rootId);
      expect(byOrigin.get('doccov-leaf')?.parentId).toBe(byOrigin.get('doccov-branch')?.id);
      // The moved row's new parent was not cloned yet when it was reached, so the clone
      // never points at a parent id outside the copied tree.
      expect(byOrigin.get('doccov-mover')?.parentId).toBeNull();
    });
  });
});
