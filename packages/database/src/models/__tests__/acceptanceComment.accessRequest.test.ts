// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptanceComments, acceptances, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  ACCEPTANCE_COMMENT_RATE_LIMITED,
  AcceptanceCommentModel,
} from '../acceptanceComment';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'access-request-owner';
const reviewer = 'access-request-reviewer';
const otherReviewer = 'access-request-other';

const model = new AcceptanceCommentModel(serverDB);

let acceptanceId: string;

beforeEach(async () => {
  await serverDB.delete(acceptanceComments);
  await serverDB.delete(acceptances);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: reviewer }, { id: otherReviewer }]);
  const [acceptance] = await serverDB
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: owner })
    .returning();
  acceptanceId = acceptance.id;
});

afterEach(async () => {
  await serverDB.delete(acceptanceComments);
  await serverDB.delete(acceptances);
  await serverDB.delete(users);
});

const askForAccess = async (authorUserId: string, status: 'granted' | 'pending' = 'pending') =>
  model.create({
    acceptanceId,
    authorUserId,
    clientId: randomUUID(),
    content: 'may I reject this?',
    kind: 'access_request',
    metadata: { accessRequest: { permission: 'collaborate', status } },
  });

describe('AcceptanceCommentModel · access requests', () => {
  describe('findLatestAccessRequest', () => {
    it('reads back the standing request of exactly one person', async () => {
      const { comment } = await askForAccess(reviewer);
      await askForAccess(otherReviewer);

      const standing = await model.findLatestAccessRequest(acceptanceId, reviewer);

      expect(standing?.id).toBe(comment.id);
      expect(standing?.metadata?.accessRequest).toMatchObject({
        permission: 'collaborate',
        status: 'pending',
      });
    });

    it('returns undefined once the requester withdrew the row', async () => {
      const { comment } = await askForAccess(reviewer);
      await serverDB
        .update(acceptanceComments)
        .set({ deletedAt: new Date() })
        .where(eq(acceptanceComments.id, comment.id));

      expect(await model.findLatestAccessRequest(acceptanceId, reviewer)).toBeUndefined();
    });

    it('ignores a request hidden inside a thread', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: randomUUID(),
        content: 'first',
      });
      const { comment: nested } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: randomUUID(),
        content: 'nested ask',
        kind: 'access_request',
        metadata: { accessRequest: { permission: 'collaborate', status: 'pending' } },
        parentCommentId: root.id,
      });

      expect(await model.findLatestAccessRequest(acceptanceId, reviewer)).toBeUndefined();
      expect(nested.parentCommentId).toBe(root.id);
    });

    it('answers undefined for somebody who never asked', async () => {
      expect(await model.findLatestAccessRequest(acceptanceId, otherReviewer)).toBeUndefined();
    });
  });

  describe('hasAccessGrant', () => {
    it('only reports a grant for the permission that was granted', async () => {
      await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: randomUUID(),
        content: 'may I reject this?',
        kind: 'access_request',
        metadata: { accessRequest: { permission: 'collaborate', status: 'granted' } },
      });

      expect(await model.hasAccessGrant(acceptanceId, reviewer, 'collaborate')).toBe(true);
    });

    it('stays false while the request is still pending', async () => {
      await askForAccess(reviewer);

      expect(await model.hasAccessGrant(acceptanceId, reviewer, 'collaborate')).toBe(false);
    });

    it('stays false when nobody asked', async () => {
      expect(await model.hasAccessGrant(acceptanceId, otherReviewer, 'collaborate')).toBe(false);
    });
  });

  describe('answerAccessRequest', () => {
    it('moves the request forward and returns the updated row', async () => {
      const { comment } = await askForAccess(reviewer);

      const answered = await model.answerAccessRequest(comment.id, 'pending', {
        decidedAt: '2026-10-26T00:00:00.000Z',
        decidedByUserId: owner,
        permission: 'collaborate',
        status: 'granted',
      });

      expect(answered?.metadata?.accessRequest).toMatchObject({
        decidedByUserId: owner,
        status: 'granted',
      });
      expect(await model.hasAccessGrant(acceptanceId, reviewer, 'collaborate')).toBe(true);
    });

    it('loses the race to the decider who answered first', async () => {
      const { comment } = await askForAccess(reviewer);
      await model.answerAccessRequest(comment.id, 'pending', {
        permission: 'collaborate',
        status: 'granted',
      });

      const late = await model.answerAccessRequest(comment.id, 'pending', {
        permission: 'collaborate',
        status: 'declined',
      });

      expect(late).toBeUndefined();
      expect(await model.hasAccessGrant(acceptanceId, reviewer, 'collaborate')).toBe(true);
    });

    it('refuses to answer a row that is not an access request', async () => {
      const { comment } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: randomUUID(),
        content: 'just a remark',
      });

      expect(
        await model.answerAccessRequest(comment.id, 'pending', {
          permission: 'collaborate',
          status: 'granted',
        }),
      ).toBeUndefined();
    });
  });

  describe('create · rate limit', () => {
    it('rolls back the remark that goes over the ceiling', async () => {
      const rateLimit = { max: 1, since: new Date(Date.now() - 60_000) };
      await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: randomUUID(),
        content: 'first',
        rateLimit,
      });

      await expect(
        model.create({
          acceptanceId,
          authorUserId: reviewer,
          clientId: randomUUID(),
          content: 'second',
          rateLimit,
        }),
      ).rejects.toThrow(ACCEPTANCE_COMMENT_RATE_LIMITED);

      const rows = await serverDB
        .select()
        .from(acceptanceComments)
        .where(eq(acceptanceComments.authorUserId, reviewer));
      expect(rows).toHaveLength(1);
    });

    it('leaves a remark inside the window alone', async () => {
      const rateLimit = { max: 1, since: new Date(Date.now() - 60_000) };

      const { comment } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: randomUUID(),
        content: 'first',
        rateLimit,
      });

      expect(comment.content).toBe('first');
    });
  });
});
