// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  acceptanceComments,
  acceptances,
  users,
  verifyCheckResults,
  verifyEvidence,
  verifyRuns,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  ACCEPTANCE_COMMENT_PARENT_NOT_FOUND,
  AcceptanceCommentModel,
  acceptanceReactionClientId,
} from '../acceptanceComment';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'acceptance-comment-owner';
const reviewer = 'acceptance-comment-reviewer';
const model = new AcceptanceCommentModel(serverDB);

let acceptanceId: string;
let otherAcceptanceId: string;
let runId: string;
let evidenceId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: reviewer }]);
  const [acceptance, other] = await serverDB
    .insert(acceptances)
    .values([
      { subjectId: randomUUID(), subjectType: 'standalone', userId: owner },
      { subjectId: randomUUID(), subjectType: 'standalone', userId: owner },
    ])
    .returning();
  acceptanceId = acceptance.id;
  otherAcceptanceId = other.id;
  const [run] = await serverDB
    .insert(verifyRuns)
    .values({ acceptanceId, roundIndex: 1, userId: owner })
    .returning();
  runId = run.id;
  const [result] = await serverDB
    .insert(verifyCheckResults)
    .values({ checkItemId: 'c2', userId: owner, verifierType: 'agent', verifyRunId: runId })
    .returning();
  const [evidence] = await serverDB
    .insert(verifyEvidence)
    .values({ checkResultId: result.id, type: 'screenshot', userId: owner })
    .returning();
  evidenceId = evidence.id;
});

afterEach(async () => {
  await serverDB.delete(users);
});

const rect = { height: 0.2, width: 0.3, x: 0.1, y: 0.1 };

describe('AcceptanceCommentModel', () => {
  describe('create', () => {
    it('writes a global comment with the round it was written against', async () => {
      const { comment, isDuplicate } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'c1',
        content: 'overall fine',
        contextRunId: runId,
      });

      expect(isDuplicate).toBe(false);
      expect(comment).toMatchObject({
        anchorType: 'acceptance',
        contextRunId: runId,
        evidenceId: null,
        kind: 'comment',
        parentCommentId: null,
      });
    });

    it('stores an evidence anchor with its region on the root only', async () => {
      const { comment } = await model.create({
        acceptanceId,
        anchor: { checkItemId: 'c2', evidenceId, rect },
        authorUserId: reviewer,
        clientId: 'region',
        content: 'detail page missing',
      });
      expect(comment).toMatchObject({
        anchorRect: rect,
        anchorType: 'evidence',
        checkItemId: 'c2',
        evidenceId,
      });

      const { comment: reply } = await model.create({
        acceptanceId,
        anchor: { checkItemId: 'c9', evidenceId, rect },
        authorUserId: owner,
        clientId: 'reply',
        content: 'will fix',
        kind: 'approval',
        parentCommentId: comment.id,
      });
      // A reply inherits the thread; it never carries its own anchor or kind.
      expect(reply).toMatchObject({
        anchorRect: null,
        anchorType: 'acceptance',
        checkItemId: null,
        kind: 'comment',
        parentCommentId: comment.id,
      });
    });

    it('flattens a reply to a reply onto the thread root', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'root',
        content: 'root',
      });
      const { comment: reply } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'reply',
        content: 'reply',
        parentCommentId: root.id,
      });
      const { comment: nested } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'nested',
        content: 'nested',
        parentCommentId: reply.id,
      });
      expect(nested.parentCommentId).toBe(root.id);
    });

    it('rejects a parent that belongs to another acceptance', async () => {
      const { comment: foreign } = await model.create({
        acceptanceId: otherAcceptanceId,
        authorUserId: owner,
        clientId: 'foreign',
        content: 'elsewhere',
      });
      await expect(
        model.create({
          acceptanceId,
          authorUserId: reviewer,
          clientId: 'x',
          content: 'x',
          parentCommentId: foreign.id,
        }),
      ).rejects.toThrow(ACCEPTANCE_COMMENT_PARENT_NOT_FOUND);
    });

    it('is idempotent on (acceptance, author, clientId)', async () => {
      const first = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'same',
        content: 'once',
      });
      const second = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'same',
        content: 'twice',
      });
      expect(second.isDuplicate).toBe(true);
      expect(second.comment.id).toBe(first.comment.id);
      expect(second.comment.content).toBe('once');
      expect(await model.listByAcceptance(acceptanceId)).toHaveLength(1);
    });
  });

  describe('listByAcceptance', () => {
    it('returns only this acceptance, oldest first', async () => {
      await model.create({ acceptanceId, authorUserId: owner, clientId: 'a', content: 'a' });
      await model.create({ acceptanceId, authorUserId: reviewer, clientId: 'b', content: 'b' });
      await model.create({
        acceptanceId: otherAcceptanceId,
        authorUserId: owner,
        clientId: 'c',
        content: 'c',
      });

      const rows = await model.listByAcceptance(acceptanceId);
      expect(rows.map((row) => row.content)).toEqual(['a', 'b']);
    });
  });

  describe('listByAcceptance cap', () => {
    it('keeps the newest rows so a fresh post is never hidden', async () => {
      // The cap is 1000; prove the ordering rule on a stand-in that is small
      // enough to write, by checking the tail rather than the head.
      const created = [];
      for (let index = 0; index < 5; index++) {
        const { comment } = await model.create({
          acceptanceId,
          authorUserId: owner,
          clientId: `c${index}`,
          content: `m${index}`,
        });
        // Five writes in a loop can land on the same microsecond, and the tie
        // then breaks on a random id. Space them so the assertion measures the
        // ordering rule rather than the clock.
        await serverDB
          .update(acceptanceComments)
          .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) })
          .where(eq(acceptanceComments.id, comment.id));
        created.push(comment.id);
      }
      const rows = await model.listByAcceptance(acceptanceId);
      // Reading order is oldest first, and the newest write is present.
      expect(rows.map((row) => row.id)).toEqual(created);
      expect(rows.at(-1)?.content).toBe('m4');
    });
  });

  describe('delete', () => {
    it('hard-deletes a root without replies and refuses another author', async () => {
      const { comment } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'd',
        content: 'd',
      });
      expect(await model.delete(comment.id, { authorUserId: owner })).toBe(false);
      expect(await model.delete(comment.id, { authorUserId: reviewer })).toBe('hard');
      expect(await model.findById(comment.id)).toBeUndefined();
    });

    it('tombstones a root with replies, then garbage-collects it with the last reply', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'root',
        content: 'root',
      });
      const { comment: reply } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'reply',
        content: 'reply',
        parentCommentId: root.id,
      });

      expect(await model.delete(root.id, { authorUserId: reviewer })).toBe('soft');
      const tombstone = await model.findById(root.id);
      expect(tombstone?.deletedAt).not.toBeNull();
      expect(tombstone?.content).toBe('');
      // Already deleted: a second delete is a no-op.
      expect(await model.delete(root.id, { authorUserId: reviewer })).toBe(false);

      expect(await model.delete(reply.id, { authorUserId: owner })).toBe('hard');
      expect(await model.findById(root.id)).toBeUndefined();
    });

    it('strips every readable body from a tombstone, not just the text', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        attachments: [{ fileId: 'file_secret' }],
        authorUserId: reviewer,
        clientId: 'rich-root',
        content: 'a body with a picture',
        editorData: { content: [{ text: 'a body with a picture' }] } as never,
      });
      await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'rich-reply',
        content: 'reply',
        parentCommentId: root.id,
      });

      expect(await model.delete(root.id, { authorUserId: reviewer })).toBe('soft');

      // The tombstone exists to hold the reply up. Leaving the editor tree or
      // the attached files behind would keep a deleted remark readable.
      const tombstone = await model.findById(root.id);
      expect(tombstone?.content).toBe('');
      expect(tombstone?.editorData).toBeNull();
      expect(tombstone?.attachments).toBeNull();
    });
  });

  describe('id', () => {
    it('is a 12-character short id from the shared alphabet', async () => {
      const { comment } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'short-id',
        content: 'hi',
      });
      // Short because it is the addressable part of the comment's URL.
      expect(comment.id).toMatch(/^[\dA-Z]{12}$/i);
    });
  });

  describe('attachments', () => {
    it('stores file ids apart from the body and allows a picture-only remark', async () => {
      const { comment } = await model.create({
        acceptanceId,
        attachments: [{ fileId: 'file_a' }, { fileId: 'file_b' }],
        authorUserId: owner,
        clientId: 'with-files',
        // An attachment alone is a complete remark: "this is what I see".
        content: '',
      });
      expect(comment.attachments).toEqual([{ fileId: 'file_a' }, { fileId: 'file_b' }]);
      expect(comment.content).toBe('');
    });

    it('leaves the column null when nothing was attached', async () => {
      const { comment } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'no-files',
        content: 'words only',
      });
      expect(comment.attachments).toBeNull();
      expect(comment.editorData).toBeNull();
    });
  });

  describe('reactions', () => {
    const react = (commentId: string, emoji: string, authorUserId: string) =>
      model.create({
        acceptanceId,
        authorUserId,
        clientId: acceptanceReactionClientId(commentId, emoji),
        content: emoji,
        kind: 'reaction',
        parentCommentId: commentId,
      });

    it('hangs on the exact comment, including a reply, instead of flattening', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'root',
        content: 'root',
      });
      const { comment: reply } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'reply',
        content: 'reply',
        parentCommentId: root.id,
      });

      const { comment: onReply } = await react(reply.id, '👍', owner);
      expect(onReply.parentCommentId).toBe(reply.id);
      expect(onReply.kind).toBe('reaction');
    });

    it('is idempotent per (comment, emoji, author) and removable', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'root',
        content: 'root',
      });

      await react(root.id, '👍', owner);
      const second = await react(root.id, '👍', owner);
      expect(second.isDuplicate).toBe(true);
      await react(root.id, '👍', reviewer);
      await react(root.id, '🎉', owner);

      const before = await model.listByAcceptance(acceptanceId);
      expect(before.filter((row) => row.kind === 'reaction')).toHaveLength(3);

      expect(
        await model.removeReaction({
          acceptanceId,
          authorUserId: owner,
          commentId: root.id,
          emoji: '👍',
        }),
      ).toBe(true);
      // A second removal is a no-op rather than an error.
      expect(
        await model.removeReaction({
          acceptanceId,
          authorUserId: owner,
          commentId: root.id,
          emoji: '👍',
        }),
      ).toBe(false);

      const after = await model.listByAcceptance(acceptanceId);
      expect(after.filter((row) => row.kind === 'reaction').map((row) => row.content)).toEqual([
        '👍',
        '🎉',
      ]);
    });

    it('does not turn a reacted-to comment into a tombstone on delete', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'root',
        content: 'root',
      });
      await react(root.id, '👍', reviewer);

      expect(await model.delete(root.id, { authorUserId: owner })).toBe('hard');
      expect(await model.listByAcceptance(acceptanceId)).toHaveLength(0);
    });
  });

  describe('setResolved', () => {
    it('resolves and reopens a root, never a reply', async () => {
      const { comment: root } = await model.create({
        acceptanceId,
        authorUserId: reviewer,
        clientId: 'root',
        content: 'root',
      });
      const { comment: reply } = await model.create({
        acceptanceId,
        authorUserId: owner,
        clientId: 'reply',
        content: 'reply',
        parentCommentId: root.id,
      });

      const resolved = await model.setResolved(root.id, true, owner);
      expect(resolved?.resolvedAt).not.toBeNull();
      expect(resolved?.resolvedByUserId).toBe(owner);

      const reopened = await model.setResolved(root.id, false, owner);
      expect(reopened?.resolvedAt).toBeNull();
      expect(reopened?.resolvedByUserId).toBeNull();

      expect(await model.setResolved(reply.id, true, owner)).toBeUndefined();
    });
  });

  it('cascades with the acceptance and keeps rows when the author is deleted', async () => {
    const { comment } = await model.create({
      acceptanceId,
      authorUserId: reviewer,
      clientId: 'keep',
      content: 'keep',
    });
    await serverDB.delete(users).where(eq(users.id, reviewer));
    expect((await model.findById(comment.id))?.authorUserId).toBeNull();

    await serverDB.delete(acceptances).where(eq(acceptances.id, acceptanceId));
    expect(
      await serverDB
        .select()
        .from(acceptanceComments)
        .where(eq(acceptanceComments.acceptanceId, acceptanceId)),
    ).toHaveLength(0);
  });
});
