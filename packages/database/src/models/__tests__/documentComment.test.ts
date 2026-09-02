// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documentCommentMentions,
  documentComments,
  documents,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  DOCUMENT_COMMENT_DOCUMENT_NOT_FOUND,
  DOCUMENT_COMMENT_PARENT_NOT_FOUND,
  DOCUMENT_COMMENT_WORKSPACE_REQUIRED,
  DocumentCommentModel,
} from '../documentComment';

const serverDB: LobeChatDatabase = await getTestDB();

const authorId = 'document-comment-author';
const memberId = 'document-comment-member';
const outsiderId = 'document-comment-outsider';
const workspaceId = 'document-comment-workspace';
const otherWorkspaceId = 'document-comment-other-workspace';
const documentId = 'document-comment-document';
const secondDocumentId = 'document-comment-second-document';
const foreignDocumentId = 'document-comment-foreign-document';

const authorModel = new DocumentCommentModel(serverDB, authorId, workspaceId);
const memberModel = new DocumentCommentModel(serverDB, memberId, workspaceId);
const outsiderModel = new DocumentCommentModel(serverDB, outsiderId, otherWorkspaceId);

const createDocument = (id: string, userId: string, targetWorkspaceId: string | null) =>
  serverDB.insert(documents).values({
    fileType: 'custom',
    id,
    source: id,
    sourceType: 'api',
    totalCharCount: 0,
    totalLineCount: 0,
    userId,
    workspaceId: targetWorkspaceId,
  });

const cleanup = async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: authorId }, { id: memberId }, { id: outsiderId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Comments', primaryOwnerId: authorId, slug: workspaceId },
    {
      id: otherWorkspaceId,
      name: 'Other comments',
      primaryOwnerId: outsiderId,
      slug: otherWorkspaceId,
    },
  ]);
  await Promise.all([
    createDocument(documentId, authorId, workspaceId),
    createDocument(secondDocumentId, authorId, workspaceId),
    createDocument(foreignDocumentId, outsiderId, otherWorkspaceId),
  ]);
});

afterEach(cleanup);

describe('DocumentCommentModel', () => {
  it('requires workspace scope and stamps the document workspace on an idempotent create', async () => {
    const personalModel = new DocumentCommentModel(serverDB, authorId);
    await expect(
      personalModel.create({ clientId: 'personal', content: 'no', documentId }),
    ).rejects.toThrow(DOCUMENT_COMMENT_WORKSPACE_REQUIRED);

    const input = { clientId: 'same-request', content: 'hello', documentId };
    const first = await authorModel.create(input);
    const duplicate = await authorModel.create(input);

    expect(first.isDuplicate).toBe(false);
    expect(first.documentAuthorUserId).toBe(authorId);
    expect(first.comment).toMatchObject({
      authorUserId: authorId,
      content: 'hello',
      documentId,
      workspaceId,
    });
    expect(duplicate).toMatchObject({ isDuplicate: true, comment: { id: first.comment.id } });
  });

  it('rejects foreign parents and flattens replies to replies into the root thread', async () => {
    await expect(
      authorModel.create({ clientId: 'foreign', content: 'no', documentId: foreignDocumentId }),
    ).rejects.toThrow(DOCUMENT_COMMENT_DOCUMENT_NOT_FOUND);

    const root = await authorModel.create({
      clientId: 'root',
      content: 'root',
      documentId,
    });
    await expect(
      authorModel.create({
        clientId: 'cross-document',
        content: 'no',
        documentId: secondDocumentId,
        parentCommentId: root.comment.id,
      }),
    ).rejects.toThrow(DOCUMENT_COMMENT_PARENT_NOT_FOUND);

    const reply = await memberModel.create({
      clientId: 'reply',
      content: 'reply',
      documentId,
      parentCommentId: root.comment.id,
    });
    const nestedReply = await authorModel.create({
      clientId: 'nested-reply',
      content: 'nested',
      documentId,
      parentCommentId: reply.comment.id,
    });

    expect(reply.comment).toMatchObject({
      parentCommentId: root.comment.id,
      replyToCommentId: null,
    });
    expect(reply.parentAuthorUserId).toBe(authorId);
    expect(nestedReply.comment).toMatchObject({
      parentCommentId: root.comment.id,
      replyToCommentId: reply.comment.id,
    });
    expect(nestedReply.parentAuthorUserId).toBe(memberId);
    expect(await authorModel.listReplies({ rootCommentId: root.comment.id })).toMatchObject({
      items: [{ id: reply.comment.id }, { id: nestedReply.comment.id }],
      total: 2,
    });

    expect(await memberModel.delete(reply.comment.id)).toBe('hard');
    expect(await authorModel.findById(nestedReply.comment.id)).toMatchObject({
      parentCommentId: root.comment.id,
      replyToCommentId: null,
    });
  });

  it('collects thread participants for replies and skips tombstoned reply targets', async () => {
    const outsiderInWorkspaceModel = new DocumentCommentModel(serverDB, outsiderId, workspaceId);
    const root = await authorModel.create({ clientId: 'root', content: 'root', documentId });
    expect(root.threadParticipantUserIds).toEqual([]);

    const memberReply = await memberModel.create({
      clientId: 'member-reply',
      content: 'member',
      documentId,
      parentCommentId: root.comment.id,
    });
    // First reply: only the root author is in the thread, and they are the
    // direct target, so nobody else needs the weaker thread ping.
    expect(memberReply.parentAuthorUserId).toBe(authorId);
    expect(memberReply.threadParticipantUserIds).toEqual([]);

    const outsiderReply = await outsiderInWorkspaceModel.create({
      clientId: 'outsider-reply',
      content: 'outsider',
      documentId,
      parentCommentId: memberReply.comment.id,
    });
    // Replying to the member's reply: member gets `replied`, root author is a
    // thread participant, the actor is excluded.
    expect(outsiderReply.parentAuthorUserId).toBe(memberId);
    expect(outsiderReply.threadParticipantUserIds).toEqual([authorId]);

    const authorReply = await authorModel.create({
      clientId: 'author-reply',
      content: 'author again',
      documentId,
      parentCommentId: root.comment.id,
    });
    // Root author replying to their own root: no direct target ping, the two
    // other repliers are participants.
    expect(authorReply.parentAuthorUserId).toBe(authorId);
    expect(new Set(authorReply.threadParticipantUserIds)).toEqual(new Set([memberId, outsiderId]));

    // Only roots leave tombstones (replies to replies are flattened). Tombstone
    // the root and reply to it: the deleted comment's author must not be a
    // target, and the live repliers are still participants.
    expect(await authorModel.delete(root.comment.id)).toBe('soft');
    const replyToTombstone = await memberModel.create({
      clientId: 'reply-to-tombstone',
      content: 'still here?',
      documentId,
      parentCommentId: root.comment.id,
    });
    expect(replyToTombstone.parentAuthorUserId).toBeNull();
    // The root author stays a participant through their live reply.
    expect(new Set(replyToTombstone.threadParticipantUserIds)).toEqual(
      new Set([authorId, outsiderId]),
    );
    expect(replyToTombstone.comment).toMatchObject({
      parentCommentId: root.comment.id,
      replyToCommentId: null,
    });

    const duplicate = await memberModel.create({
      clientId: 'reply-to-tombstone',
      content: 'still here?',
      documentId,
      parentCommentId: root.comment.id,
    });
    expect(duplicate).toMatchObject({ isDuplicate: true, threadParticipantUserIds: [] });
  });

  it('scopes updates and deletes to the author unless explicitly overridden', async () => {
    const created = await authorModel.create({
      clientId: 'owned',
      content: 'original',
      documentId,
    });

    expect(await memberModel.update(created.comment.id, { content: 'hacked' })).toBeUndefined();
    expect(await memberModel.delete(created.comment.id)).toBe(false);
    expect((await authorModel.findById(created.comment.id))?.content).toBe('original');

    expect(await memberModel.delete(created.comment.id, { overrideAuthorScope: true })).toBe(
      'hard',
    );
    expect(await authorModel.findById(created.comment.id)).toBeUndefined();
  });

  it('persists Markdown source and Lexical JSON for rendering and future edits', async () => {
    const initialEditorData = {
      root: {
        children: [{ children: [{ format: 1, text: 'bold', type: 'text' }], type: 'paragraph' }],
        type: 'root',
      },
    };
    const created = await authorModel.create({
      clientId: 'markdown',
      content: '**bold**',
      documentId,
      editorData: initialEditorData,
    });

    expect(created.comment).toMatchObject({
      content: '**bold**',
      editorData: initialEditorData,
    });

    const nextEditorData = {
      root: {
        children: [{ children: [{ text: 'updated', type: 'text' }], type: 'paragraph' }],
        type: 'root',
      },
    };
    const updated = await authorModel.update(created.comment.id, {
      content: '[updated](https://lobehub.com)',
      editorData: nextEditorData,
    });

    expect(updated?.comment).toMatchObject({
      content: '[updated](https://lobehub.com)',
      editorData: nextEditorData,
    });
  });

  it('stores validated mentions transactionally and diffs them on update', async () => {
    const created = await authorModel.create({
      clientId: 'mentioned',
      content: 'hello @member',
      documentId,
      mentionedUserIds: [memberId, memberId],
    });
    const duplicate = await authorModel.create({
      clientId: 'mentioned',
      content: 'hello @member',
      documentId,
      mentionedUserIds: [memberId],
    });

    expect(created.addedMentionUserIds).toEqual([memberId]);
    expect(duplicate.addedMentionUserIds).toEqual([]);
    expect(
      await serverDB
        .select({ mentionedUserId: documentCommentMentions.mentionedUserId })
        .from(documentCommentMentions)
        .where(eq(documentCommentMentions.commentId, created.comment.id)),
    ).toEqual([{ mentionedUserId: memberId }]);

    const removed = await authorModel.update(
      created.comment.id,
      { content: 'mention removed' },
      { mentionedUserIds: [] },
    );
    expect(removed?.addedMentionUserIds).toEqual([]);
    expect(
      await serverDB
        .select()
        .from(documentCommentMentions)
        .where(eq(documentCommentMentions.commentId, created.comment.id)),
    ).toEqual([]);

    const addedAgain = await authorModel.update(
      created.comment.id,
      { content: 'hello again @member' },
      { mentionedUserIds: [memberId] },
    );
    expect(addedAgain?.addedMentionUserIds).toEqual([memberId]);

    await memberModel.create({
      clientId: 'mentioned-reply',
      content: 'reply',
      documentId,
      parentCommentId: created.comment.id,
    });
    expect(await authorModel.delete(created.comment.id)).toBe('soft');
    expect(
      await serverDB
        .select()
        .from(documentCommentMentions)
        .where(eq(documentCommentMentions.commentId, created.comment.id)),
    ).toEqual([]);
  });

  it('keeps a deleted root as a tombstone until its final reply is removed', async () => {
    const root = await authorModel.create({
      clientId: 'tombstone-root',
      content: 'root',
      documentId,
    });
    const reply = await memberModel.create({
      clientId: 'tombstone-reply',
      content: 'reply',
      documentId,
      parentCommentId: root.comment.id,
    });

    expect(await authorModel.delete(root.comment.id)).toBe('soft');
    expect(await authorModel.findById(root.comment.id)).toMatchObject({
      content: '',
      deletedAt: expect.any(Date),
    });
    expect(await memberModel.delete(reply.comment.id)).toBe('hard');
    expect(await authorModel.findById(root.comment.id)).toBeUndefined();
  });

  it('paginates roots and replies oldest-first and returns an active total', async () => {
    const rootRows = await serverDB
      .insert(documentComments)
      .values([
        {
          authorUserId: authorId,
          clientId: 'old',
          content: 'old',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          documentId,
          workspaceId,
        },
        {
          authorUserId: authorId,
          clientId: 'new',
          content: 'new',
          createdAt: new Date('2024-01-03T00:00:00Z'),
          documentId,
          workspaceId,
        },
      ])
      .returning();
    const oldRoot = rootRows.find(({ content }) => content === 'old')!;
    await serverDB.insert(documentComments).values([
      {
        authorUserId: memberId,
        clientId: 'reply-2',
        content: 'reply 2',
        createdAt: new Date('2024-01-02T00:00:02Z'),
        documentId,
        parentCommentId: oldRoot.id,
        workspaceId,
      },
      {
        authorUserId: memberId,
        clientId: 'reply-1',
        content: 'reply 1',
        createdAt: new Date('2024-01-02T00:00:01Z'),
        documentId,
        parentCommentId: oldRoot.id,
        workspaceId,
      },
    ]);

    const firstPage = await authorModel.listThreads({ documentId, limit: 1 });
    const secondPage = await authorModel.listThreads({
      cursor: firstPage.nextCursor!,
      documentId,
      limit: 1,
    });
    expect(firstPage.items[0]).toMatchObject({ replyCount: 2, root: { content: 'old' } });
    expect(secondPage.items[0].root.content).toBe('new');

    const firstReplies = await authorModel.listReplies({ limit: 1, rootCommentId: oldRoot.id });
    const secondReplies = await authorModel.listReplies({
      cursor: firstReplies.nextCursor!,
      limit: 1,
      rootCommentId: oldRoot.id,
    });
    expect(firstReplies).toMatchObject({ items: [{ content: 'reply 1' }], total: 2 });
    expect(secondReplies.items[0].content).toBe('reply 2');
    expect(await authorModel.summary(documentId)).toEqual({ total: 4 });

    await serverDB
      .update(documentComments)
      .set({ deletedAt: new Date() })
      .where(eq(documentComments.id, oldRoot.id));
    expect(await authorModel.summary(documentId)).toEqual({ total: 3 });
    expect(await outsiderModel.summary(foreignDocumentId)).toEqual({ total: 0 });

    // Single-thread lookup for deep links: live replies only, scoped to the workspace.
    expect(await authorModel.countLiveReplies(oldRoot.id)).toBe(2);
    expect(await outsiderModel.countLiveReplies(oldRoot.id)).toBe(0);
    await serverDB
      .update(documentComments)
      .set({ deletedAt: new Date() })
      .where(eq(documentComments.clientId, 'reply-2'));
    expect(await authorModel.countLiveReplies(oldRoot.id)).toBe(1);
  });
});
