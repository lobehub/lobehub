// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptanceComments, acceptances, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceCommentModel } from '../acceptanceComment';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'acceptance-comment-cov-owner';
const reviewer = 'acceptance-comment-cov-reviewer';
const model = new AcceptanceCommentModel(serverDB);

let acceptanceId: string;

/**
 * Run the next `transaction` body on a driver-boundary proxy whose result rows can be rewritten,
 * to reach shapes the real database never hands back (an aggregate with no row, a row that
 * vanished between two reads). Queries still execute against the real test database.
 */
const runNextTransactionThrough = (rewrite: (query: string) => boolean) => {
  const proxyDB = createProxyTestDB(serverDB, (query, result) =>
    rewrite(query) ? [] : result.rows,
  );
  vi.spyOn(serverDB, 'transaction').mockImplementationOnce(async (body) =>
    body(proxyDB as unknown as Parameters<typeof body>[0]),
  );
};

const isCount = (query: string) => query.includes('count(*)');

const comment = (authorUserId: string, clientId: string, parentCommentId?: string) =>
  model.create({ acceptanceId, authorUserId, clientId, content: clientId, parentCommentId });

const rowById = async (id: string) =>
  serverDB.query.acceptanceComments.findFirst({ where: eq(acceptanceComments.id, id) });

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: owner }, { id: reviewer }]);
  const [acceptance] = await serverDB
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: owner })
    .returning();
  acceptanceId = acceptance.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Acceptances and their comments cascade with the owner.
  await serverDB.delete(users).where(inArray(users.id, [owner, reviewer]));
});

describe('AcceptanceCommentModel coverage', () => {
  describe('create', () => {
    it('lets the comment through when the rate-limit count yields no row', async () => {
      runNextTransactionThrough(isCount);

      const { comment: created, isDuplicate } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'rate-limit-no-row',
        content: 'hello',
        rateLimit: { max: 0, since: new Date(Date.now() - 60_000) },
      });

      expect(isDuplicate).toBe(false);
      expect(await rowById(created.id)).toMatchObject({ content: 'hello' });
    });
  });

  describe('delete', () => {
    it('lets a moderator remove someone else’s comment', async () => {
      const { comment: remark } = await comment(reviewer, 'moderated');

      expect(await model.delete(remark.id, { moderator: true })).toBe('hard');
      expect(await rowById(remark.id)).toBeUndefined();
    });

    it('keeps a tombstoned root while another reply still holds it up', async () => {
      const { comment: root } = await comment(owner, 'root');
      const { comment: first } = await comment(reviewer, 'reply-1', root.id);
      const { comment: second } = await comment(reviewer, 'reply-2', root.id);
      expect(await model.delete(root.id, { authorUserId: owner })).toBe('soft');

      expect(await model.delete(first.id, { authorUserId: reviewer })).toBe('hard');

      expect(await rowById(first.id)).toBeUndefined();
      expect(await rowById(root.id)).toMatchObject({ content: '' });
      expect((await rowById(root.id))?.deletedAt).toBeInstanceOf(Date);
      expect(await rowById(second.id)).toMatchObject({ content: 'reply-2' });
    });

    it('reports nothing removed when the thread root vanishes before it is locked', async () => {
      const { comment: root } = await comment(owner, 'vanishing-root');
      runNextTransactionThrough((query) => query.includes('for update'));

      expect(await model.delete(root.id, { authorUserId: owner })).toBe(false);
      expect(await rowById(root.id)).toMatchObject({ content: 'vanishing-root' });
    });

    it('treats reply and sibling counts that yield no row as zero', async () => {
      const { comment: root } = await comment(owner, 'lone-root');
      const { comment: reply } = await comment(reviewer, 'lone-reply', root.id);
      // A reply props the root up, so this first delete only tombstones it.
      expect(await model.delete(root.id, { authorUserId: owner })).toBe('soft');
      runNextTransactionThrough(isCount);

      expect(await model.delete(reply.id, { authorUserId: reviewer })).toBe('hard');

      expect(await rowById(reply.id)).toBeUndefined();
      expect(await rowById(root.id)).toBeUndefined();
    });
  });
});
