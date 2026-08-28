// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  messagePlugins,
  messages,
  topicCommentMentions,
  topicComments,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  purgeExpiredTopicCommentModeration,
  TOPIC_COMMENT_MESSAGE_NOT_IN_TOPIC,
  TOPIC_COMMENT_PARENT_NOT_FOUND,
  TOPIC_COMMENT_REPLY_CANNOT_ANCHOR,
  TOPIC_COMMENT_REPLY_DEPTH_EXCEEDED,
  TOPIC_COMMENT_TOPIC_NOT_FOUND,
  TOPIC_COMMENT_WORKSPACE_REQUIRED,
  TopicCommentModel,
} from '../topicComment';

const serverDB: LobeChatDatabase = await getTestDB();

const authorId = 'tc-author';
const memberId = 'tc-member';
const outsiderId = 'tc-outsider';

const workspaceAId = 'tc-ws-a';
const workspaceBId = 'tc-ws-b';

const workspaceTopicId = 'tc-topic-a';
const secondWorkspaceTopicId = 'tc-topic-idempotency-a2';
const personalTopicId = 'tc-topic-personal';
const otherWorkspaceTopicId = 'tc-topic-b';

const anchoredMessageId = 'tc-msg-anchor';
const otherTopicMessageId = 'tc-msg-other';

const authorModel = new TopicCommentModel(serverDB, authorId, workspaceAId);
const memberModel = new TopicCommentModel(serverDB, memberId, workspaceAId);
const outsiderModel = new TopicCommentModel(serverDB, outsiderId, workspaceBId);
const authorInOtherWorkspaceModel = new TopicCommentModel(serverDB, authorId, workspaceBId);
const personalModel = new TopicCommentModel(serverDB, authorId);

const cleanup = async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
};

beforeEach(async () => {
  await cleanup();

  await serverDB.insert(users).values([{ id: authorId }, { id: memberId }, { id: outsiderId }]);

  await serverDB.insert(workspaces).values([
    { id: workspaceAId, name: 'Workspace A', primaryOwnerId: authorId, slug: 'tc-ws-a' },
    { id: workspaceBId, name: 'Workspace B', primaryOwnerId: outsiderId, slug: 'tc-ws-b' },
  ]);

  await serverDB.insert(topics).values([
    { id: workspaceTopicId, userId: authorId, workspaceId: workspaceAId },
    { id: secondWorkspaceTopicId, userId: authorId, workspaceId: workspaceAId },
    { id: personalTopicId, userId: authorId, workspaceId: null },
    { id: otherWorkspaceTopicId, userId: outsiderId, workspaceId: workspaceBId },
  ]);

  await serverDB.insert(messages).values([
    {
      content: 'anchor message content '.repeat(20),
      id: anchoredMessageId,
      role: 'assistant',
      topicId: workspaceTopicId,
      userId: authorId,
      workspaceId: workspaceAId,
    },
    {
      content: 'a message in another workspace topic',
      id: otherTopicMessageId,
      role: 'user',
      topicId: otherWorkspaceTopicId,
      userId: outsiderId,
      workspaceId: workspaceBId,
    },
  ]);
});

afterEach(cleanup);

describe('TopicCommentModel', () => {
  describe('createWithMentions', () => {
    it('should create a topic-level comment stamped with the topic workspaceId', async () => {
      await serverDB.insert(messages).values([
        {
          content: 'member message',
          id: 'tc-msg-participant-1',
          role: 'user',
          topicId: workspaceTopicId,
          userId: memberId,
          workspaceId: workspaceAId,
        },
        {
          content: 'another member message',
          id: 'tc-msg-participant-2',
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: memberId,
          workspaceId: workspaceAId,
        },
      ]);

      const result = await authorModel.createWithMentions({
        clientId: 'client-1',
        content: 'a topic-level comment',
        topicId: workspaceTopicId,
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.addedMentionUserIds).toEqual([]);
      expect(result.topicParticipantUserIds).toHaveLength(2);
      expect(result.topicParticipantUserIds).toEqual(expect.arrayContaining([authorId, memberId]));
      expect(result.topicOwnerUserId).toBe(authorId);
      expect(result.comment).toMatchObject({
        anchorPreview: null,
        authorUserId: authorId,
        content: 'a topic-level comment',
        messageId: null,
        topicId: workspaceTopicId,
        workspaceId: workspaceAId,
      });
    });

    it('should snapshot a truncated anchorPreview for message-anchored comments', async () => {
      const result = await authorModel.createWithMentions({
        clientId: 'client-2',
        content: 'anchored comment',
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.messageId).toBe(anchoredMessageId);
      expect(result.comment.anchorPreview?.role).toBe('assistant');
      expect(result.comment.anchorPreview?.excerpt).toHaveLength(200);
      expect(result.comment.anchorPreview?.excerpt.startsWith('anchor message content')).toBe(true);
      expect(result.messageOwnerUserId).toBe(authorId);
      expect(result.topicParticipantUserIds).toEqual([]);
    });

    it('should snapshot the final authored text of a tool-anchored assistant group', async () => {
      const userMessageId = 'tc-group-user';
      const rootAssistantId = 'tc-group-root';
      const toolMessageId = 'tc-group-tool';
      const finalAssistantId = 'tc-group-final';
      const toolCallId = 'tc-group-tool-call';
      await serverDB.insert(messages).values([
        {
          content: 'research this',
          id: userMessageId,
          role: 'user',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: '',
          id: rootAssistantId,
          parentId: userMessageId,
          role: 'assistant',
          tools: [{ id: toolCallId }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'tool result',
          id: toolMessageId,
          parentId: rootAssistantId,
          role: 'tool',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'the final agent answer',
          id: finalAssistantId,
          parentId: toolMessageId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        id: toolMessageId,
        toolCallId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-assistant-group-final',
        content: 'comment on the complete agent reply',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment).toMatchObject({
        anchorPreview: { excerpt: 'the final agent answer', role: 'assistant' },
        messageId: rootAssistantId,
      });
    });

    it('should resolve the complete reply when the topic exceeds the message query page size', async () => {
      const rootAssistantId = 'tc-long-topic-root';
      await serverDB.insert(messages).values([
        {
          content: '',
          createdAt: new Date('2020-01-01'),
          id: rootAssistantId,
          role: 'assistant',
          tools: [{ id: 'tc-long-topic-tool-call' }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'the final answer outside the newest message page',
          createdAt: new Date('2020-01-01T00:00:01Z'),
          id: 'tc-long-topic-final',
          parentId: rootAssistantId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);
      await serverDB.insert(messages).values(
        Array.from({ length: 1001 }, (_, index) => ({
          content: `newer unrelated message ${index}`,
          createdAt: new Date('2021-01-01'),
          id: `tc-long-topic-noise-${index.toString().padStart(4, '0')}`,
          role: 'user',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        })),
      );

      const result = await authorModel.createWithMentions({
        clientId: 'client-long-topic-preview',
        content: 'comment on an older complete reply',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe(
        'the final answer outside the newest message page',
      );
    });

    it('should include the user parent when grouping a toolless narration head', async () => {
      const userMessageId = 'tc-narrated-group-user';
      const rootAssistantId = 'tc-narrated-group-root';
      const toolMessageId = 'tc-narrated-group-tool';
      const toolCallId = 'tc-narrated-tool-call';
      await serverDB.insert(messages).values([
        {
          content: 'investigate this',
          id: userMessageId,
          role: 'user',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'I will check first',
          id: rootAssistantId,
          parentId: userMessageId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'I found the right tool',
          id: 'tc-narrated-group-tool-step',
          parentId: rootAssistantId,
          role: 'assistant',
          tools: [{ id: toolCallId }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'tool result',
          id: toolMessageId,
          parentId: 'tc-narrated-group-tool-step',
          role: 'tool',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'the later complete answer',
          id: 'tc-narrated-group-final',
          parentId: toolMessageId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        id: toolMessageId,
        toolCallId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-narrated-group-final',
        content: 'comment on the final answer',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe('the later complete answer');
    });

    it('should keep the rendered answer when a trailing tool status closes the group', async () => {
      const userMessageId = 'tc-trailing-status-user';
      const rootAssistantId = 'tc-trailing-status-root';
      const statusAssistantId = 'tc-trailing-status-step';
      const toolMessageId = 'tc-trailing-status-tool';
      const toolCallId = 'tc-trailing-status-call';
      await serverDB.insert(messages).values([
        {
          content: 'investigate and update this issue',
          id: userMessageId,
          role: 'user',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'This is the actual answer.',
          id: rootAssistantId,
          parentId: userMessageId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'Now I will update the issue.',
          id: statusAssistantId,
          parentId: rootAssistantId,
          role: 'assistant',
          tools: [{ id: toolCallId }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'issue updated',
          id: toolMessageId,
          parentId: statusAssistantId,
          role: 'tool',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        id: toolMessageId,
        toolCallId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-trailing-status-preview',
        content: 'comment on the answer, not the bookkeeping status',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe('This is the actual answer.');
    });

    it('should use shared final-answer semantics for a single mixed tool block', async () => {
      const userMessageId = 'tc-single-mixed-user';
      const rootAssistantId = 'tc-single-mixed-root';
      const mixedAssistantId = 'tc-single-mixed-step';
      const toolMessageId = 'tc-single-mixed-tool';
      const toolCallId = 'tc-single-mixed-call';
      await serverDB.insert(messages).values([
        {
          content: 'investigate and update this issue',
          id: userMessageId,
          role: 'user',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'This is the answer outside the workflow.',
          id: rootAssistantId,
          parentId: userMessageId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'This long tool narration has multiple sentences. It remains workflow content.',
          id: mixedAssistantId,
          parentId: rootAssistantId,
          role: 'assistant',
          tools: [{ id: toolCallId }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'issue updated',
          id: toolMessageId,
          parentId: mixedAssistantId,
          role: 'tool',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        id: toolMessageId,
        toolCallId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-single-mixed-preview',
        content: 'comment on the answer outside the workflow',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe(
        'This is the answer outside the workflow.',
      );
    });

    it('should hydrate assistant errors before resolving a mixed tool-block preview', async () => {
      const userMessageId = 'tc-mixed-error-user';
      const rootAssistantId = 'tc-mixed-error-root';
      const erroredAssistantId = 'tc-mixed-error-step';
      const toolMessageId = 'tc-mixed-error-tool';
      const toolCallId = 'tc-mixed-error-call';
      const erroredAnswer =
        'The operation failed after producing this answer. The details remain visible.';
      await serverDB.insert(messages).values([
        {
          content: 'investigate and update this issue',
          id: userMessageId,
          role: 'user',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'This is the earlier answer.',
          id: rootAssistantId,
          parentId: userMessageId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: erroredAnswer,
          error: {
            message: 'The follow-up failed.',
            type: 'ProviderBizError',
          },
          id: erroredAssistantId,
          parentId: rootAssistantId,
          role: 'assistant',
          tools: [{ id: toolCallId }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'partial tool result',
          id: toolMessageId,
          parentId: erroredAssistantId,
          role: 'tool',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        id: toolMessageId,
        toolCallId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-mixed-error-preview',
        content: 'comment on the errored answer outside the workflow',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe(erroredAnswer);
    });

    it('should prefer a post-task summary rendered after the main assistant chain', async () => {
      const rootAssistantId = 'tc-task-completion-root';
      const toolMessageId = 'tc-task-completion-tool';
      const toolCallId = 'tc-task-completion-tool-call';
      await serverDB.insert(messages).values([
        {
          content: 'I started the background task',
          id: rootAssistantId,
          role: 'assistant',
          tools: [{ id: toolCallId }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'background task result',
          id: toolMessageId,
          parentId: rootAssistantId,
          role: 'tool',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'the post-task summary shown last',
          id: 'tc-task-completion-summary',
          metadata: {
            signal: {
              sourceToolCallId: toolCallId,
              sourceToolName: 'backgroundTask',
              type: 'task-completion',
            },
          },
          parentId: toolMessageId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        id: toolMessageId,
        toolCallId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-task-completion-preview',
        content: 'comment on the completed task reply',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe('the post-task summary shown last');
    });

    it('should keep an empty preview for an assistant group with no authored text', async () => {
      const rootAssistantId = 'tc-tool-only-group-root';
      await serverDB.insert(messages).values({
        content: '',
        id: rootAssistantId,
        role: 'assistant',
        tools: [{ id: 'tc-tool-only-call' }],
        topicId: workspaceTopicId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-tool-only-group',
        content: 'comment on a tool-only reply',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview).toEqual({ excerpt: '', role: 'assistant' });
    });

    it('should truncate a derived group preview without splitting a surrogate pair', async () => {
      const rootAssistantId = 'tc-long-group-root';
      await serverDB.insert(messages).values([
        {
          content: '',
          id: rootAssistantId,
          role: 'assistant',
          tools: [{ id: 'tc-long-group-tool-call' }],
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
        {
          content: 'a'.repeat(199) + '😀 and more text',
          id: 'tc-long-group-final',
          parentId: rootAssistantId,
          role: 'assistant',
          topicId: workspaceTopicId,
          userId: authorId,
          workspaceId: workspaceAId,
        },
      ]);

      const result = await authorModel.createWithMentions({
        clientId: 'client-long-group-preview',
        content: 'comment on a long grouped reply',
        messageId: rootAssistantId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe('a'.repeat(199));
    });

    it('should not split a surrogate pair at the excerpt cut (jsonb rejects lone surrogates)', async () => {
      // 199 ASCII chars put the 200th code unit in the middle of the emoji's
      // surrogate pair — a bare slice(0, 200) would keep a lone high
      // surrogate, and the jsonb INSERT itself would fail in Postgres.
      const emojiMessageId = 'tc-msg-emoji-boundary';
      await serverDB.insert(messages).values({
        content: 'a'.repeat(199) + '😀 and more text',
        id: emojiMessageId,
        role: 'user',
        topicId: workspaceTopicId,
        userId: authorId,
        workspaceId: workspaceAId,
      });

      const result = await authorModel.createWithMentions({
        clientId: 'client-emoji-cut',
        content: 'anchored across an emoji boundary',
        messageId: emojiMessageId,
        topicId: workspaceTopicId,
      });

      expect(result.comment.anchorPreview?.excerpt).toBe('a'.repeat(199));
    });

    it('should create mention rows and dedupe the input list', async () => {
      const result = await authorModel.createWithMentions({
        clientId: 'client-3',
        content: 'mentioning @member',
        mentionedUserIds: [memberId, memberId],
        topicId: workspaceTopicId,
      });

      expect(result.addedMentionUserIds).toEqual([memberId]);

      const mentions = await authorModel.getMentions(result.comment.id);
      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        commentId: result.comment.id,
        mentionedUserId: memberId,
        workspaceId: workspaceAId,
      });
    });

    it('should return the existing row on retried create with the same clientId', async () => {
      const first = await authorModel.createWithMentions({
        clientId: 'client-retry',
        content: 'first attempt',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });
      const retry = await authorModel.createWithMentions({
        clientId: 'client-retry',
        content: 'retried attempt',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });

      expect(retry.isDuplicate).toBe(true);
      expect(retry.comment.id).toBe(first.comment.id);
      expect(retry.comment.content).toBe('first attempt');
      expect(retry.addedMentionUserIds).toEqual([]);
      expect(retry.topicOwnerUserId).toBe(authorId);

      const rows = await serverDB
        .select()
        .from(topicComments)
        .where(eq(topicComments.authorUserId, authorId));
      expect(rows).toHaveLength(1);
    });

    it('should allow the same clientId for different authors', async () => {
      await authorModel.createWithMentions({
        clientId: 'shared-client-id',
        content: 'author comment',
        topicId: workspaceTopicId,
      });
      const other = await memberModel.createWithMentions({
        clientId: 'shared-client-id',
        content: 'member comment',
        topicId: workspaceTopicId,
      });

      expect(other.isDuplicate).toBe(false);
      expect(other.comment.authorUserId).toBe(memberId);
    });

    it('should return parent-not-found when reply creation races with root deletion', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'reply-delete-race-root',
        content: 'root deleted during reply creation',
        topicId: workspaceTopicId,
      });
      let releaseDelete!: () => void;
      let reportRootLocked!: () => void;
      const deleteReleased = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      const rootLocked = new Promise<void>((resolve) => {
        reportRootLocked = resolve;
      });
      const deleting = serverDB.transaction(async (tx) => {
        await tx
          .select({ id: topicComments.id })
          .from(topicComments)
          .where(eq(topicComments.id, root.comment.id))
          .for('update');
        reportRootLocked();
        await deleteReleased;
        await tx.delete(topicComments).where(eq(topicComments.id, root.comment.id));
      });
      await rootLocked;

      const creatingReply = memberModel.createWithMentions({
        clientId: 'reply-delete-race-reply',
        content: 'reply racing with root deletion',
        parentCommentId: root.comment.id,
        topicId: workspaceTopicId,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      releaseDelete();

      const [deleteResult, createResult] = await Promise.allSettled([deleting, creatingReply]);
      expect(deleteResult.status).toBe('fulfilled');
      expect(createResult).toMatchObject({
        reason: expect.objectContaining({ message: TOPIC_COMMENT_PARENT_NOT_FOUND }),
        status: 'rejected',
      });
    });

    it('should allow the same clientId for the same author in different topics', async () => {
      await authorModel.createWithMentions({
        clientId: 'topic-scoped-client-id',
        content: 'first topic comment',
        topicId: workspaceTopicId,
      });
      const other = await authorModel.createWithMentions({
        clientId: 'topic-scoped-client-id',
        content: 'second topic comment',
        topicId: secondWorkspaceTopicId,
      });

      expect(other.isDuplicate).toBe(false);
      expect(other.comment).toMatchObject({
        content: 'second topic comment',
        topicId: secondWorkspaceTopicId,
        workspaceId: workspaceAId,
      });
    });

    it('should allow the same clientId for the same author in different workspaces', async () => {
      await authorModel.createWithMentions({
        clientId: 'workspace-independent-client-id',
        content: 'workspace A comment',
        topicId: workspaceTopicId,
      });
      const other = await authorInOtherWorkspaceModel.createWithMentions({
        clientId: 'workspace-independent-client-id',
        content: 'workspace B comment',
        topicId: otherWorkspaceTopicId,
      });

      expect(other.isDuplicate).toBe(false);
      expect(other.comment).toMatchObject({
        content: 'workspace B comment',
        topicId: otherWorkspaceTopicId,
        workspaceId: workspaceBId,
      });
    });

    it('should reject personal-mode topics', async () => {
      await expect(
        authorModel.createWithMentions({
          clientId: 'client-4',
          content: 'comment on personal topic',
          topicId: personalTopicId,
        }),
      ).rejects.toThrow(TOPIC_COMMENT_TOPIC_NOT_FOUND);
    });

    it('should reject cross-workspace topics with the same error as missing topics', async () => {
      await expect(
        authorModel.createWithMentions({
          clientId: 'client-5',
          content: 'cross workspace',
          topicId: otherWorkspaceTopicId,
        }),
      ).rejects.toThrow(TOPIC_COMMENT_TOPIC_NOT_FOUND);

      await expect(
        authorModel.createWithMentions({
          clientId: 'client-6',
          content: 'missing topic',
          topicId: 'tc-topic-missing',
        }),
      ).rejects.toThrow(TOPIC_COMMENT_TOPIC_NOT_FOUND);
    });

    it('should reject a messageId that belongs to another topic', async () => {
      await expect(
        authorModel.createWithMentions({
          clientId: 'client-7',
          content: 'bad anchor',
          messageId: otherTopicMessageId,
          topicId: workspaceTopicId,
        }),
      ).rejects.toThrow(TOPIC_COMMENT_MESSAGE_NOT_IN_TOPIC);
    });

    it('should reject callers without a workspaceId', async () => {
      await expect(
        personalModel.createWithMentions({
          clientId: 'client-8',
          content: 'no workspace context',
          topicId: workspaceTopicId,
        }),
      ).rejects.toThrow(TOPIC_COMMENT_WORKSPACE_REQUIRED);
    });
  });

  describe('update', () => {
    it('should let the author update content and editorData', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-u1',
        content: 'original',
        topicId: workspaceTopicId,
      });

      const result = await authorModel.update(comment.id, {
        content: 'edited',
        editorData: { root: {} },
      });

      expect(result?.comment).toMatchObject({ content: 'edited', editorData: { root: {} } });
    });

    it('should NOT let another member update the comment', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-u2',
        content: 'original',
        topicId: workspaceTopicId,
      });

      const result = await memberModel.update(comment.id, { content: 'hacked' });

      expect(result).toBeUndefined();
      const [row] = await serverDB
        .select()
        .from(topicComments)
        .where(eq(topicComments.id, comment.id));
      expect(row.content).toBe('original');
    });

    it('should ignore an overrideAuthorScope-like option — edits are author-only by design', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-u3',
        content: 'original',
        topicId: workspaceTopicId,
      });

      // Moderation is delete-only: rewriting someone else's words under their
      // name is impersonation, so update() deliberately has no override path.
      // Smuggle the flag past the type system to prove the runtime ignores it.
      const result = await memberModel.update(comment.id, { content: 'moderated' }, {
        overrideAuthorScope: true,
      } as never);

      expect(result).toBeUndefined();
      const [row] = await serverDB
        .select()
        .from(topicComments)
        .where(eq(topicComments.id, comment.id));
      expect(row.content).toBe('original');
    });

    it('should diff mentions and report only newly added user ids', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-u5',
        content: 'with mentions',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });

      const added = await authorModel.update(
        comment.id,
        { content: 'add outsider' },
        { mentionedUserIds: [memberId, outsiderId] },
      );
      expect(added?.addedMentionUserIds).toEqual([outsiderId]);

      const removed = await authorModel.update(
        comment.id,
        { content: 'drop member' },
        { mentionedUserIds: [outsiderId] },
      );
      expect(removed?.addedMentionUserIds).toEqual([]);

      const mentions = await authorModel.getMentions(comment.id);
      expect(mentions.map((m) => m.mentionedUserId)).toEqual([outsiderId]);
    });

    it('should leave mentions untouched when mentionedUserIds is omitted', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-u6',
        content: 'with mentions',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });

      await authorModel.update(comment.id, { content: 'edited' });

      const mentions = await authorModel.getMentions(comment.id);
      expect(mentions.map((m) => m.mentionedUserId)).toEqual([memberId]);
    });
  });

  describe('delete', () => {
    it('should let the author delete own comment and cascade mention rows', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-d1',
        content: 'to delete',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });

      const deleted = await authorModel.delete(comment.id);

      expect(deleted).toBe('hard');
      const mentionRows = await serverDB
        .select()
        .from(topicCommentMentions)
        .where(eq(topicCommentMentions.commentId, comment.id));
      expect(mentionRows).toHaveLength(0);
    });

    it('should NOT let another member delete the comment without override', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-d2',
        content: 'protected',
        topicId: workspaceTopicId,
      });

      expect(await memberModel.delete(comment.id)).toBe(false);
      expect(await authorModel.findById(comment.id)).toBeDefined();
    });

    it('should let overrideAuthorScope delete others comments', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-d3',
        content: 'moderated away',
        topicId: workspaceTopicId,
      });

      expect(await memberModel.delete(comment.id, { overrideAuthorScope: true })).toBe('hard');
    });

    it('should NOT cross workspaces even with overrideAuthorScope', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-d4',
        content: 'protected',
        topicId: workspaceTopicId,
      });

      expect(await outsiderModel.delete(comment.id, { overrideAuthorScope: true })).toBe(false);
      expect(await authorModel.findById(comment.id)).toBeDefined();
    });
  });

  describe('workspace owner moderation', () => {
    it('should retain content, editorData and mentions during the 30-day recovery window', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-mod-retain',
        content: 'recoverable content',
        editorData: { root: { children: [] } },
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });
      const now = new Date('2026-07-22T10:00:00Z');

      const result = await memberModel.moderateRemove(comment.id, now);

      expect(result?.comment).toMatchObject({
        content: 'recoverable content',
        editorData: { root: { children: [] } },
        moderatedAt: now,
        moderatedByUserId: memberId,
      });
      expect(result?.moderationExpiresAt).toEqual(new Date('2026-08-21T10:00:00Z'));
      expect(await authorModel.getMentions(comment.id)).toHaveLength(1);
      expect(
        await authorModel.update(comment.id, { content: 'cannot edit while removed' }),
      ).toBeUndefined();
      expect(await authorModel.delete(comment.id)).toBe(false);
    });

    it('should keep author self-deletion on the irreversible path', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-mod-self',
        content: 'self-owned',
        topicId: workspaceTopicId,
      });

      expect(await authorModel.moderateRemove(comment.id)).toBeUndefined();
      expect(await authorModel.delete(comment.id)).toBe('hard');
      expect(await authorModel.findById(comment.id)).toBeUndefined();
    });

    it('should restore retained content without changing its edit timestamp or mentions', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-mod-restore',
        content: 'restore me',
        editorData: { root: { version: 1 } },
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });
      const removedAt = new Date('2026-07-22T10:00:00Z');
      await memberModel.moderateRemove(comment.id, removedAt);

      const restored = await authorModel.restoreModerated(
        comment.id,
        new Date('2026-08-01T10:00:00Z'),
      );

      expect(restored).toMatchObject({
        content: 'restore me',
        editorData: { root: { version: 1 } },
        moderatedAt: null,
        moderatedByUserId: null,
        moderationExpiresAt: null,
        updatedAt: comment.updatedAt,
      });
      expect(await authorModel.getMentions(comment.id)).toHaveLength(1);
    });

    it('should reject restore once the recovery window expires', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-mod-expired-restore',
        content: 'too late',
        topicId: workspaceTopicId,
      });
      await memberModel.moderateRemove(comment.id, new Date('2026-07-01T00:00:00Z'));

      expect(
        await authorModel.restoreModerated(comment.id, new Date('2026-08-01T00:00:00Z')),
      ).toBeUndefined();
      expect((await authorModel.findById(comment.id))?.content).toBe('too late');
    });

    it('should hide no-reply removals from other members while retaining the author and owner views', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-mod-visibility',
        content: 'private retained body',
        topicId: workspaceTopicId,
      });
      await memberModel.moderateRemove(comment.id);

      expect(await outsiderModel.findById(comment.id)).toBeUndefined();
      expect(await authorModel.findById(comment.id)).toMatchObject({ id: comment.id });
      expect(await memberModel.findById(comment.id, { includeAllModerated: true })).toMatchObject({
        content: 'private retained body',
      });
    });

    it('should keep a moderated root visible to other members while active replies preserve the thread', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'client-mod-thread-root',
        content: 'removed root',
        topicId: workspaceTopicId,
      });
      await memberModel.createWithMentions({
        clientId: 'client-mod-thread-reply',
        content: 'active reply',
        parentCommentId: root.comment.id,
        topicId: workspaceTopicId,
      });
      await memberModel.moderateRemove(root.comment.id);

      const page = await new TopicCommentModel(serverDB, outsiderId, workspaceAId).listThreads({
        topicId: workspaceTopicId,
      });
      expect(page.items.map(({ root: item }) => item.id)).toContain(root.comment.id);
      expect(page.items.find(({ root: item }) => item.id === root.comment.id)?.replyCount).toBe(1);
    });

    it('should hard-delete expired removals without replies', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-mod-purge-hard',
        content: 'purge me',
        editorData: { root: {} },
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });
      await memberModel.moderateRemove(comment.id, new Date('2026-06-01T00:00:00Z'));

      const result = await purgeExpiredTopicCommentModeration(serverDB, {
        now: new Date('2026-07-02T00:00:00Z'),
      });

      expect(result).toMatchObject({ hardDeleted: 1, processed: 1, tombstoned: 0 });
      expect(await authorModel.findById(comment.id)).toBeUndefined();
      expect(await authorModel.getMentions(comment.id)).toHaveLength(0);
    });

    it('should be idempotent when an expired-removal purge is retried', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-mod-purge-idempotent',
        content: 'purge once',
        topicId: workspaceTopicId,
      });
      await memberModel.moderateRemove(comment.id, new Date('2026-06-01T00:00:00Z'));
      const now = new Date('2026-07-02T00:00:00Z');

      const first = await purgeExpiredTopicCommentModeration(serverDB, { now });
      const retry = await purgeExpiredTopicCommentModeration(serverDB, { now });

      expect(first).toMatchObject({ hardDeleted: 1, processed: 1, tombstoned: 0 });
      expect(retry).toEqual({
        garbageCollected: 0,
        hardDeleted: 0,
        processed: 0,
        tombstoned: 0,
      });
    });

    it('should sanitize an expired root and preserve its active replies', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'client-mod-purge-root',
        content: 'sensitive root',
        editorData: { root: { secret: true } },
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });
      const reply = await memberModel.createWithMentions({
        clientId: 'client-mod-purge-reply',
        content: 'preserved reply',
        parentCommentId: root.comment.id,
        topicId: workspaceTopicId,
      });
      await memberModel.moderateRemove(root.comment.id, new Date('2026-06-01T00:00:00Z'));

      const result = await purgeExpiredTopicCommentModeration(serverDB, {
        now: new Date('2026-07-02T00:00:00Z'),
      });

      expect(result).toMatchObject({ hardDeleted: 0, processed: 1, tombstoned: 1 });
      expect(await authorModel.findById(root.comment.id)).toMatchObject({
        content: '',
        deletedAt: expect.any(Date),
        editorData: null,
        moderatedAt: null,
        moderationExpiresAt: null,
      });
      expect(await authorModel.getMentions(root.comment.id)).toHaveLength(0);
      expect(await authorModel.findById(reply.comment.id)).toMatchObject({
        content: 'preserved reply',
      });
    });
  });

  describe('findById', () => {
    it('should scope reads to the workspace', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-f1',
        content: 'readable',
        topicId: workspaceTopicId,
      });

      expect(await memberModel.findById(comment.id)).toBeDefined();
      expect(await outsiderModel.findById(comment.id)).toBeUndefined();
    });
  });

  describe('listThreads', () => {
    const seedRoots = async () => {
      const a = await authorModel.createWithMentions({
        clientId: 'client-l1',
        content: 'first',
        topicId: workspaceTopicId,
      });
      const b = await authorModel.createWithMentions({
        clientId: 'client-l2',
        content: 'second',
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
      });
      const c = await authorModel.createWithMentions({
        clientId: 'client-l3',
        content: 'third',
        topicId: workspaceTopicId,
      });

      // Explicit timestamps — never rely on insert order. b and c share createdAt
      // so cursor pagination exercises the id tie-breaker. Keep the IDs fixed and
      // lowercase so JavaScript and PostgreSQL collations agree on their order.
      const base = new Date('2026-01-01T10:00:00Z');
      const later = new Date('2026-01-02T10:00:00Z');
      const aId = 'tcm_list_root_a';
      const bId = 'tcm_list_root_b';
      const cId = 'tcm_list_root_c';
      await serverDB
        .update(topicComments)
        .set({ createdAt: base, id: aId })
        .where(eq(topicComments.id, a.comment.id));
      await serverDB
        .update(topicComments)
        .set({ createdAt: later, id: bId })
        .where(eq(topicComments.id, b.comment.id));
      await serverDB
        .update(topicComments)
        .set({ createdAt: later, id: cId })
        .where(eq(topicComments.id, c.comment.id));

      return {
        a: { ...a.comment, id: aId },
        b: { ...b.comment, id: bId },
        c: { ...c.comment, id: cId },
        expectedOrder: [cId, bId, aId],
      };
    };

    it('should return newest root threads first with batched reply counts only', async () => {
      const { a, expectedOrder } = await seedRoots();
      await Promise.all([
        memberModel.createWithMentions({
          clientId: 'client-l-reply-1',
          content: 'first reply',
          parentCommentId: a.id,
          topicId: workspaceTopicId,
        }),
        authorModel.createWithMentions({
          clientId: 'client-l-reply-2',
          content: 'second reply',
          parentCommentId: a.id,
          topicId: workspaceTopicId,
        }),
      ]);

      const page = await authorModel.listThreads({ topicId: workspaceTopicId });

      expect(page.items.map((thread) => thread.root.id)).toEqual(expectedOrder);
      expect(page.nextCursor).toBeNull();
      const firstThread = page.items.find((thread) => thread.root.id === a.id);
      expect(firstThread?.replyCount).toBe(2);
      expect(firstThread).not.toHaveProperty('replies');
    });

    it('should continue root pagination after the cursor root is hard-deleted', async () => {
      const { a, expectedOrder } = await seedRoots();
      await memberModel.createWithMentions({
        clientId: 'client-l-page-reply',
        content: 'a reply outside the root-page count',
        parentCommentId: a.id,
        topicId: workspaceTopicId,
      });

      const page1 = await authorModel.listThreads({ limit: 2, topicId: workspaceTopicId });
      expect(page1.items.map((thread) => thread.root.id)).toEqual(expectedOrder.slice(0, 2));
      expect(page1.nextCursor).not.toBeNull();

      // Hard deletion is normal. A value cursor must keep its position without
      // re-reading this now-missing row and silently restarting at page one.
      expect(await authorModel.delete(expectedOrder[1])).toBe('hard');

      const page2 = await authorModel.listThreads({
        cursor: page1.nextCursor!,
        limit: 2,
        topicId: workspaceTopicId,
      });
      expect(page2.items.map((thread) => thread.root.id)).toEqual(expectedOrder.slice(2));
      expect(page2.nextCursor).toBeNull();
    });

    it('should return reply counts when filtering roots by messageId', async () => {
      const { b } = await seedRoots();
      await memberModel.createWithMentions({
        clientId: 'client-l-message-reply',
        content: 'message thread reply',
        parentCommentId: b.id,
        topicId: workspaceTopicId,
      });

      const page = await authorModel.listThreads({
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].root.id).toBe(b.id);
      expect(page.items[0].replyCount).toBe(1);
      expect(page.items[0]).not.toHaveProperty('replies');
    });

    it('should return nothing for another workspace context', async () => {
      await seedRoots();

      expect(await outsiderModel.listThreads({ topicId: workspaceTopicId })).toEqual({
        items: [],
        nextCursor: null,
      });
    });
  });

  describe('listReplies', () => {
    it('should paginate one thread replies with a composite cursor', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'client-lr-root',
        content: 'reply-page root',
        topicId: workspaceTopicId,
      });
      const replies = await Promise.all([
        memberModel.createWithMentions({
          clientId: 'client-lr-1',
          content: 'reply one',
          parentCommentId: root.comment.id,
          topicId: workspaceTopicId,
        }),
        authorModel.createWithMentions({
          clientId: 'client-lr-2',
          content: 'reply two',
          parentCommentId: root.comment.id,
          topicId: workspaceTopicId,
        }),
        memberModel.createWithMentions({
          clientId: 'client-lr-3',
          content: 'reply three',
          parentCommentId: root.comment.id,
          topicId: workspaceTopicId,
        }),
      ]);

      const base = new Date('2026-01-01T10:00:00Z');
      const later = new Date('2026-01-02T10:00:00Z');
      // Fixed lowercase IDs keep JavaScript and PostgreSQL collations aligned
      // while the shared timestamp still exercises the id tie-breaker.
      const firstReplyId = 'tcm_list_reply_a';
      const secondReplyId = 'tcm_list_reply_b';
      const thirdReplyId = 'tcm_list_reply_c';
      await serverDB
        .update(topicComments)
        .set({ createdAt: base, id: firstReplyId })
        .where(eq(topicComments.id, replies[0].comment.id));
      await serverDB
        .update(topicComments)
        .set({ createdAt: later, id: secondReplyId })
        .where(eq(topicComments.id, replies[1].comment.id));
      await serverDB
        .update(topicComments)
        .set({ createdAt: later, id: thirdReplyId })
        .where(eq(topicComments.id, replies[2].comment.id));
      const expectedOrder = [firstReplyId, secondReplyId, thirdReplyId];

      const page1 = await authorModel.listReplies({ limit: 2, rootCommentId: root.comment.id });
      expect(page1.items.map((reply) => reply.id)).toEqual(expectedOrder.slice(0, 2));
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.total).toBe(3);

      await authorModel.delete(expectedOrder[1], { overrideAuthorScope: true });

      const page2 = await authorModel.listReplies({
        cursor: page1.nextCursor!,
        limit: 2,
        rootCommentId: root.comment.id,
      });
      expect(page2.items.map((reply) => reply.id)).toEqual(expectedOrder.slice(2));
      expect(page2.nextCursor).toBeNull();
      expect(page2).not.toHaveProperty('total');
      expect(
        (await authorModel.listReplies({ limit: 2, rootCommentId: root.comment.id })).total,
      ).toBe(2);

      expect(await outsiderModel.listReplies({ rootCommentId: root.comment.id })).toEqual({
        items: [],
        nextCursor: null,
        total: 0,
      });
    });

    it('should exclude moderated replies from the live total for privileged viewers', async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'client-lr-moderated-root',
        content: 'reply total root',
        topicId: workspaceTopicId,
      });
      await authorModel.createWithMentions({
        clientId: 'client-lr-live',
        content: 'live reply',
        parentCommentId: root.comment.id,
        topicId: workspaceTopicId,
      });
      const moderated = await memberModel.createWithMentions({
        clientId: 'client-lr-moderated',
        content: 'moderated reply',
        parentCommentId: root.comment.id,
        topicId: workspaceTopicId,
      });
      await authorModel.moderateRemove(moderated.comment.id);

      const page = await authorModel.listReplies(
        { rootCommentId: root.comment.id },
        { includeAllModerated: true },
      );

      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(1);
    });
  });

  describe('summary', () => {
    it('should count totals and per-message counts separately', async () => {
      await authorModel.createWithMentions({
        clientId: 'client-s1',
        content: 'topic level',
        topicId: workspaceTopicId,
      });
      await authorModel.createWithMentions({
        clientId: 'client-s2',
        content: 'anchored one',
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
      });
      await memberModel.createWithMentions({
        clientId: 'client-s3',
        content: 'anchored two',
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
      });

      const summary = await authorModel.summary(workspaceTopicId);

      expect(summary.total).toBe(3);
      expect(summary.countByMessage).toEqual({ [anchoredMessageId]: 2 });
    });
  });

  describe('anchor message deletion', () => {
    it('should keep the comment with anchorPreview after the message is hard-deleted', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-a1',
        content: 'survives anchor deletion',
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
      });

      await serverDB.delete(messages).where(eq(messages.id, anchoredMessageId));

      const row = await authorModel.findById(comment.id);
      expect(row?.messageId).toBeNull();
      expect(row?.anchorPreview?.excerpt.startsWith('anchor message content')).toBe(true);
    });
  });

  describe('topic deletion', () => {
    it('should cascade comments and mentions when the topic is deleted', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-t1',
        content: 'cascades away',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });

      await serverDB.delete(topics).where(eq(topics.id, workspaceTopicId));

      const rows = await serverDB
        .select()
        .from(topicComments)
        .where(eq(topicComments.id, comment.id));
      expect(rows).toHaveLength(0);
      const mentionRows = await serverDB
        .select()
        .from(topicCommentMentions)
        .where(eq(topicCommentMentions.commentId, comment.id));
      expect(mentionRows).toHaveLength(0);
    });
  });

  describe('author account deletion (tombstone)', () => {
    it('should keep the comment with a NULL author when the author account is deleted', async () => {
      // Author must NOT be the topic creator: deleting the creator cascades the
      // topic (topics.userId) and takes every comment with it — the tombstone
      // only protects against the comment *author* leaving.
      const { comment } = await memberModel.createWithMentions({
        clientId: 'client-tomb-1',
        content: 'survives author deletion',
        mentionedUserIds: [authorId],
        topicId: workspaceTopicId,
      });

      await serverDB.delete(users).where(eq(users.id, memberId));

      const row = await authorModel.findById(comment.id);
      expect(row).toBeDefined();
      expect(row?.authorUserId).toBeNull();
      expect(row?.content).toBe('survives author deletion');
      // Mentions *made by* the tombstoned comment stay (target user still exists)
      expect(await authorModel.getMentions(comment.id)).toHaveLength(1);
    });

    it('should cascade mention rows that point at the deleted user', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-tomb-2',
        content: 'mentions the leaver',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });

      await serverDB.delete(users).where(eq(users.id, memberId));

      expect(await authorModel.getMentions(comment.id)).toHaveLength(0);
    });

    it('should make orphaned comments deletable only via overrideAuthorScope, never editable', async () => {
      const { comment } = await memberModel.createWithMentions({
        clientId: 'client-tomb-3',
        content: 'orphaned',
        topicId: workspaceTopicId,
      });

      await serverDB.delete(users).where(eq(users.id, memberId));

      // The author-scoped predicate never matches NULL — no caller owns the row
      expect(await authorModel.update(comment.id, { content: 'hijack' })).toBeUndefined();
      expect(await authorModel.delete(comment.id)).toBe(false);

      // Owner-level override still manages it, within the workspace only
      expect(await outsiderModel.delete(comment.id, { overrideAuthorScope: true })).toBe(false);
      expect(await authorModel.delete(comment.id, { overrideAuthorScope: true })).toBe('hard');
    });

    it('should cascade all comments when the topic creator account is deleted', async () => {
      const { comment } = await memberModel.createWithMentions({
        clientId: 'client-tomb-4',
        content: 'dies with the topic',
        topicId: workspaceTopicId,
      });

      await serverDB.delete(users).where(eq(users.id, authorId));

      const rows = await serverDB
        .select()
        .from(topicComments)
        .where(eq(topicComments.id, comment.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('anchored-requires-preview CHECK', () => {
    it('should reject a message-anchored row inserted without anchorPreview', async () => {
      const values = {
        authorUserId: authorId,
        clientId: 'client-check-1',
        content: 'anchored but no snapshot',
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
        workspaceId: workspaceAId,
      };

      // Same row minus the snapshot is rejected; with it, it lands — the CHECK
      // is the only differing variable. (Drizzle wraps the constraint name in
      // the error cause, so we can't match on the message text.)
      await expect(serverDB.insert(topicComments).values(values)).rejects.toThrow();
      await expect(
        serverDB
          .insert(topicComments)
          .values({ ...values, anchorPreview: { excerpt: 'snapshot' } }),
      ).resolves.toBeDefined();
    });

    it('should accept the orphaned state (NULL messageId with a preview)', async () => {
      await expect(
        serverDB.insert(topicComments).values({
          anchorPreview: { excerpt: 'left over from a deleted anchor' },
          authorUserId: authorId,
          clientId: 'client-check-2',
          content: 'orphaned is legal',
          messageId: null,
          topicId: workspaceTopicId,
          workspaceId: workspaceAId,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('threads (replies)', () => {
    const seedThread = async () => {
      const root = await authorModel.createWithMentions({
        clientId: 'client-th-root',
        content: 'thread root',
        messageId: anchoredMessageId,
        topicId: workspaceTopicId,
      });
      const reply = await memberModel.createWithMentions({
        clientId: 'client-th-reply',
        content: 'a reply',
        parentCommentId: root.comment.id,
        topicId: workspaceTopicId,
      });
      return { reply: reply.comment, root: root.comment };
    };

    it('should create a reply without any anchor of its own', async () => {
      const { root, reply } = await seedThread();

      expect(reply.parentCommentId).toBe(root.id);
      expect(reply.messageId).toBeNull();
      expect(reply.anchorPreview).toBeNull();
    });

    it('should reject replying to a reply (single level only)', async () => {
      const { reply } = await seedThread();

      await expect(
        authorModel.createWithMentions({
          clientId: 'client-th-deep',
          content: 'reply to a reply',
          parentCommentId: reply.id,
          topicId: workspaceTopicId,
        }),
      ).rejects.toThrow(TOPIC_COMMENT_REPLY_DEPTH_EXCEEDED);
    });

    it('should reject a reply that tries to anchor to a message', async () => {
      const { root } = await seedThread();

      await expect(
        memberModel.createWithMentions({
          clientId: 'client-th-anchor',
          content: 'anchored reply',
          messageId: anchoredMessageId,
          parentCommentId: root.id,
          topicId: workspaceTopicId,
        }),
      ).rejects.toThrow(TOPIC_COMMENT_REPLY_CANNOT_ANCHOR);
    });

    it('should reject cross-topic and cross-workspace parents with one error', async () => {
      const { root } = await seedThread();

      await serverDB
        .insert(topics)
        .values([{ id: 'tc-topic-a2', userId: authorId, workspaceId: workspaceAId }]);

      // Parent exists but lives in another topic of the same workspace
      await expect(
        authorModel.createWithMentions({
          clientId: 'client-th-cross-topic',
          content: 'cross-topic reply',
          parentCommentId: root.id,
          topicId: 'tc-topic-a2',
        }),
      ).rejects.toThrow(TOPIC_COMMENT_PARENT_NOT_FOUND);

      // Parent in another workspace is indistinguishable from missing
      const foreign = await outsiderModel.createWithMentions({
        clientId: 'client-th-foreign',
        content: 'foreign root',
        topicId: otherWorkspaceTopicId,
      });
      await expect(
        authorModel.createWithMentions({
          clientId: 'client-th-cross-ws',
          content: 'cross-workspace reply',
          parentCommentId: foreign.comment.id,
          topicId: workspaceTopicId,
        }),
      ).rejects.toThrow(TOPIC_COMMENT_PARENT_NOT_FOUND);
    });

    it('should soft-delete a root with live replies and keep the thread anchor', async () => {
      const { root, reply } = await seedThread();
      await authorModel.update(root.id, {}, { mentionedUserIds: [memberId] });

      const mode = await authorModel.delete(root.id);
      expect(mode).toBe('soft');

      const tombstone = await authorModel.findById(root.id);
      // Content retracted, structure and anchor retained
      expect(tombstone?.deletedAt).not.toBeNull();
      expect(tombstone?.content).toBe('');
      expect(tombstone?.editorData).toBeNull();
      expect(tombstone?.messageId).toBe(anchoredMessageId);
      expect(tombstone?.anchorPreview).not.toBeNull();
      // Mentions dropped, replies untouched
      expect(await authorModel.getMentions(root.id)).toHaveLength(0);
      expect(await authorModel.findById(reply.id)).toMatchObject({ content: 'a reply' });
    });

    it('should make tombstones neither editable nor deletable again', async () => {
      const { root } = await seedThread();
      await authorModel.delete(root.id);

      expect(await authorModel.update(root.id, { content: 'necromancy' })).toBeUndefined();
      expect(await authorModel.delete(root.id)).toBe(false);
      expect(await authorModel.delete(root.id, { overrideAuthorScope: true })).toBe(false);
    });

    it('should allow replying to a tombstoned root (thread is still alive)', async () => {
      const { root } = await seedThread();
      await authorModel.delete(root.id);

      const late = await authorModel.createWithMentions({
        clientId: 'client-th-late',
        content: 'late reply',
        parentCommentId: root.id,
        topicId: workspaceTopicId,
      });

      expect(late.comment.parentCommentId).toBe(root.id);
    });

    it('should GC the tombstone when its last live reply is hard-deleted', async () => {
      const { root, reply } = await seedThread();
      const second = await authorModel.createWithMentions({
        clientId: 'client-th-second',
        content: 'second reply',
        parentCommentId: root.id,
        topicId: workspaceTopicId,
      });
      await authorModel.delete(root.id);

      // First reply goes — tombstone stays (one live reply left)
      expect(await memberModel.delete(reply.id)).toBe('hard');
      expect(await authorModel.findById(root.id)).toBeDefined();

      // Last reply goes — tombstone is GC'd in the same transaction
      expect(await authorModel.delete(second.comment.id)).toBe('hard');
      expect(await authorModel.findById(root.id)).toBeUndefined();
    });

    it('should serialize concurrent final-reply deletes before tombstone GC', async () => {
      // PGlite serializes transactions on one connection; TEST_SERVER_DB=1
      // exercises the real race across separate PostgreSQL pool connections.
      const trials = 20;
      const orphanedRootIds: string[] = [];

      for (let i = 0; i < trials; i++) {
        const root = await authorModel.createWithMentions({
          clientId: `client-th-concurrent-replies-root-${i}`,
          content: 'concurrent replies root',
          topicId: workspaceTopicId,
        });
        const [first, second] = await Promise.all([
          memberModel.createWithMentions({
            clientId: `client-th-concurrent-replies-first-${i}`,
            content: 'first concurrent reply',
            parentCommentId: root.comment.id,
            topicId: workspaceTopicId,
          }),
          authorModel.createWithMentions({
            clientId: `client-th-concurrent-replies-second-${i}`,
            content: 'second concurrent reply',
            parentCommentId: root.comment.id,
            topicId: workspaceTopicId,
          }),
        ]);
        expect(await authorModel.delete(root.comment.id)).toBe('soft');

        await Promise.all([
          memberModel.delete(first.comment.id),
          authorModel.delete(second.comment.id),
        ]);

        if (await authorModel.findById(root.comment.id)) {
          orphanedRootIds.push(root.comment.id);
          // Keep later trials independent if this regression reappears.
          await serverDB.delete(topicComments).where(eq(topicComments.id, root.comment.id));
        }
      }

      expect(orphanedRootIds).toEqual([]);
    });

    it('should serialize deleting a root with deleting its last reply', async () => {
      const trials = 20;
      const orphanedRootIds: string[] = [];

      for (let i = 0; i < trials; i++) {
        const root = await authorModel.createWithMentions({
          clientId: `client-th-concurrent-root-${i}`,
          content: 'concurrent root delete',
          topicId: workspaceTopicId,
        });
        const reply = await memberModel.createWithMentions({
          clientId: `client-th-concurrent-root-reply-${i}`,
          content: 'last concurrent reply',
          parentCommentId: root.comment.id,
          topicId: workspaceTopicId,
        });

        await Promise.all([
          authorModel.delete(root.comment.id),
          memberModel.delete(reply.comment.id),
        ]);

        if (await authorModel.findById(root.comment.id)) {
          orphanedRootIds.push(root.comment.id);
          await serverDB.delete(topicComments).where(eq(topicComments.id, root.comment.id));
        }
      }

      expect(orphanedRootIds).toEqual([]);
    });

    it('should hard-delete a root whose replies were all deleted first', async () => {
      const { root, reply } = await seedThread();

      expect(await memberModel.delete(reply.id)).toBe('hard');
      // No live replies left — the root deletes hard, no tombstone
      expect(await authorModel.delete(root.id)).toBe('hard');
      expect(await authorModel.findById(root.id)).toBeUndefined();
    });

    it('should reject raw hard-deleting a parent with replies at the DB layer', async () => {
      const { root } = await seedThread();

      // Self-FK has no delete action: the DB itself is the backstop against
      // destroying a thread by hard-deleting its root outside the model.
      await expect(
        serverDB.delete(topicComments).where(eq(topicComments.id, root.id)),
      ).rejects.toThrow();
    });

    it('should still cascade whole threads when the topic is deleted', async () => {
      const { root, reply } = await seedThread();

      await serverDB.delete(topics).where(eq(topics.id, workspaceTopicId));

      const rows = await serverDB
        .select()
        .from(topicComments)
        .where(inArray(topicComments.id, [root.id, reply.id]));
      expect(rows).toHaveLength(0);
    });

    it('should exclude tombstones from total while keeping live threads in message counts', async () => {
      const { reply, root } = await seedThread();

      const before = await authorModel.summary(workspaceTopicId);
      // Root (anchored) + reply: total counts both, the badge counts the thread
      expect(before.total).toBe(2);
      expect(before.countByMessage).toEqual({ [anchoredMessageId]: 1 });

      await authorModel.delete(root.id);

      const after = await authorModel.summary(workspaceTopicId);
      // The tombstone drops out of total, but keeps the live thread discoverable
      // from its anchored message until the last reply is deleted.
      expect(after.total).toBe(1);
      expect(after.countByMessage).toEqual({ [anchoredMessageId]: 1 });

      await memberModel.delete(reply.id);

      const afterLastReply = await authorModel.summary(workspaceTopicId);
      expect(afterLastReply.total).toBe(0);
      expect(afterLastReply.countByMessage).toEqual({});
    });
  });

  describe('getMentions', () => {
    it('should scope mention reads to the workspace', async () => {
      const { comment } = await authorModel.createWithMentions({
        clientId: 'client-m1',
        content: 'with mention',
        mentionedUserIds: [memberId],
        topicId: workspaceTopicId,
      });

      expect(await authorModel.getMentions(comment.id)).toHaveLength(1);
      expect(await outsiderModel.getMentions(comment.id)).toHaveLength(0);
    });

    it('should reject workspace-less callers for every method', async () => {
      await expect(personalModel.listThreads({ topicId: workspaceTopicId })).rejects.toThrow(
        TOPIC_COMMENT_WORKSPACE_REQUIRED,
      );
      await expect(personalModel.listReplies({ rootCommentId: 'any' })).rejects.toThrow(
        TOPIC_COMMENT_WORKSPACE_REQUIRED,
      );
      await expect(personalModel.summary(workspaceTopicId)).rejects.toThrow(
        TOPIC_COMMENT_WORKSPACE_REQUIRED,
      );
      await expect(personalModel.findById('any')).rejects.toThrow(TOPIC_COMMENT_WORKSPACE_REQUIRED);
      await expect(personalModel.delete('any')).rejects.toThrow(TOPIC_COMMENT_WORKSPACE_REQUIRED);
      await expect(personalModel.update('any', { content: 'x' })).rejects.toThrow(
        TOPIC_COMMENT_WORKSPACE_REQUIRED,
      );
      await expect(personalModel.getMentions('any')).rejects.toThrow(
        TOPIC_COMMENT_WORKSPACE_REQUIRED,
      );
    });
  });
});
