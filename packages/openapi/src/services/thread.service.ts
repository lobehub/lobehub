import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { messages, threads, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertCanUseTopicTargets } from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCreatorTopicTargets } from '@/server/routers/lambda/_helpers/shareVisitorTargetGuard';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { BaseService } from '../common/base.service';
import type { TopicThreadCreateRequest, TopicThreadUpdateRequest } from '../types/topic.type';

type ThreadAction = 'TOPIC_CREATE' | 'TOPIC_DELETE' | 'TOPIC_UPDATE';

const THREAD_COLUMNS = {
  createdAt: threads.createdAt,
  id: threads.id,
  parentThreadId: threads.parentThreadId,
  status: threads.status,
  title: threads.title,
  topicId: threads.topicId,
  type: threads.type,
  updatedAt: threads.updatedAt,
};

/**
 * Create, update and remove a topic's threads, reusing `ThreadModel` /
 * `MessageModel` the way the tRPC `thread` router does. Every thread is
 * addressed through its topic, so a thread id from another topic is a 404.
 */
export class ThreadService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  /** Server guards throw `TRPCError`; the controller maps its code to the HTTP status. */
  private fail(error: unknown, operation: string): never {
    if (error instanceof TRPCError) throw error;
    this.handleServiceError(error, operation);
  }

  private get guardCtx() {
    return { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
  }

  private get threadModel() {
    return new ThreadModel(this.db, this.userId, this.workspaceId);
  }

  /** The topic once the caller may `action` its threads; 404 outside the caller's scope. */
  private async findTopic(topicId: string, action: ThreadAction) {
    const permission = await this.resolveOperationPermission(action, { targetTopicId: topicId });
    if (!permission.isPermitted) {
      throw this.createAuthorizationError(permission.message || 'No permission for this topic');
    }

    // Copies and writes run through caller-scoped repositories, so resolve the
    // topic in that same scope rather than everything an `:all` reader can see.
    const conditions = [
      eq(topics.id, topicId),
      isNull(topics.deletedAt),
      this.buildWorkspaceWhere(topics),
    ];

    const [topic] = await this.db
      .select({ agentId: topics.agentId, groupId: topics.groupId, id: topics.id })
      .from(topics)
      .where(and(...conditions))
      .limit(1);
    if (!topic) throw this.createNotFoundError('Topic not found');

    await assertCanUseTopicTargets(this.guardCtx, [topicId]);
    await assertCreatorTopicTargets(this.guardCtx, [topicId]);
    return topic;
  }

  private async getThread(topicId: string, threadId: string) {
    const [thread] = await this.db
      .select({ ...THREAD_COLUMNS, userId: threads.userId })
      .from(threads)
      .where(
        and(
          eq(threads.id, threadId),
          eq(threads.topicId, topicId),
          isNull(threads.deletedAt),
          this.buildWorkspaceWhere(threads),
        ),
      )
      .limit(1);
    if (!thread) throw this.createNotFoundError('Thread not found in this topic');

    return thread;
  }

  /** The thread a member may change: its creator, or a holder of the `:all` scope. */
  private async getManageableThread(topicId: string, threadId: string, action: ThreadAction) {
    const { userId, ...thread } = await this.getThread(topicId, threadId);
    await this.assertRowManageable(userId, action, 'thread');
    return thread;
  }

  async create(topicId: string, request: TopicThreadCreateRequest) {
    try {
      const topic = await this.findTopic(topicId, 'TOPIC_CREATE');

      if (request.sourceMessageId) {
        const [source] = await this.db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.id, request.sourceMessageId),
              eq(messages.topicId, topicId),
              this.buildWorkspaceWhere(messages),
            ),
          )
          .limit(1);
        if (!source) throw this.createNotFoundError('Source message not found in this topic');
      }
      if (request.parentThreadId) await this.getThread(topicId, request.parentThreadId);

      const { message } = request;
      const title =
        request.title ?? (message ? markdownToTxt(message.content).slice(0, 80) : undefined);

      const thread = await this.threadModel.create({
        parentThreadId: request.parentThreadId,
        sourceMessageId: request.sourceMessageId,
        title,
        topicId,
        type: request.type,
      });
      if (!thread) throw this.createConflictError('Thread could not be created');

      const created = message
        ? await new MessageModel(this.db, this.userId, this.workspaceId).create({
            agentId: topic.agentId ?? undefined,
            content: message.content,
            groupId: topic.groupId ?? undefined,
            parentId: request.sourceMessageId,
            role: message.role,
            threadId: thread.id,
            topicId,
          } as Parameters<MessageModel['create']>[0])
        : undefined;

      return {
        messageId: created?.id ?? null,
        thread: await this.getThread(topicId, thread.id).then(({ userId: _, ...row }) => row),
      };
    } catch (error) {
      this.fail(error, 'Create thread');
    }
  }

  async update(topicId: string, threadId: string, patch: TopicThreadUpdateRequest) {
    try {
      await this.findTopic(topicId, 'TOPIC_UPDATE');
      await this.getManageableThread(topicId, threadId, 'TOPIC_UPDATE');

      await this.threadModel.update(threadId, patch);

      const { userId: _, ...thread } = await this.getThread(topicId, threadId);
      return thread;
    } catch (error) {
      this.fail(error, 'Update thread');
    }
  }

  async remove(topicId: string, threadId: string) {
    try {
      await this.findTopic(topicId, 'TOPIC_DELETE');
      await this.getManageableThread(topicId, threadId, 'TOPIC_DELETE');

      await this.threadModel.delete(threadId);
      return { deleted: true as const, id: threadId };
    } catch (error) {
      this.fail(error, 'Delete thread');
    }
  }
}
