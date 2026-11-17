import { and, asc, eq, isNull } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { TopicModel } from '@/database/models/topic';
import { TopicShareModel } from '@/database/models/topicShare';
import { TopicRepository } from '@/database/repositories/topic';
import { TopicImporterRepo } from '@/database/repositories/topicImporter';
import { agents, messagePlugins, messages, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notShareVisitorMessage } from '@/database/utils/shareVisitor';
import { appEnv } from '@/envs/app';
import {
  assertCanUseConversationTargets,
  assertCanUseTopicTargets,
  assertCanViewConversationTargets,
  assertCanViewTopicTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCreatorTopicTargets } from '@/server/routers/lambda/_helpers/shareVisitorTargetGuard';
import {
  assertCanManageTopicShare,
  recordTopicShareAudit,
} from '@/server/routers/lambda/topic/share';
import { readTopicTranscript } from '@/server/routers/lambda/topic/transcript';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';
import { GoalTopicHandoffService } from '@/server/services/goal/topicHandoff';
import { TrashService } from '@/server/services/trash';

import { BaseService } from '../common/base.service';
import { buildPageInfo, decodeOffsetCursor } from '../helpers/pagination';
import { projectPublicTopic } from '../helpers/public-fields';
import { renderTranscriptMarkdown } from '../helpers/transcript-markdown';
import type {
  ExportedTopicMessage,
  ExportedTopicPayload,
  TopicBatchRequest,
  TopicBranchRequest,
  TopicCloneRequest,
  TopicForkRequest,
  TopicImportRequest,
  TopicSearchQuery,
  TopicShare,
  TopicShareRequest,
  TopicTranscript,
  TopicTranscriptQuery,
} from '../types/topic.type';
import { TopicService } from './topic.service';

const DEFAULT_TRANSCRIPT_LIMIT = 50;
const MAX_TRANSCRIPT_LIMIT = 500;

type TopicAction = 'TOPIC_CREATE' | 'TOPIC_DELETE' | 'TOPIC_READ' | 'TOPIC_UPDATE';

const toIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

/** Drop `null`/`undefined` so optional export fields are simply absent. */
const compact = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field != null)) as T;

/**
 * Topic copies (clone / fork / branch), transcript, export / import, search,
 * batch actions, share and read state for the REST API.
 *
 * Each call reuses the repository or model the tRPC `topic` router uses and
 * applies the same guards: RBAC, the workspace General-access check on the
 * owning conversation, and the refusal to copy or mutate an agent-share
 * visitor's topic.
 */
export class TopicBranchService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private get guardCtx() {
    return { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
  }

  private topics() {
    return new TopicService(this.db, this.userId, this.workspaceId);
  }

  /**
   * The topic row behind `topicId` once the caller passed the RBAC check for
   * `action` on it; 404 when it is outside the caller's scope or in the trash.
   */
  private async findTopic(topicId: string, action: TopicAction) {
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
      .select()
      .from(topics)
      .where(and(...conditions))
      .limit(1);
    if (!topic) throw this.createNotFoundError('Topic not found');

    return topic;
  }

  /** A topic the caller may copy content out of, or write to. */
  private async findUsableTopic(topicId: string, action: TopicAction) {
    const topic = await this.findTopic(topicId, action);
    await assertCanUseTopicTargets(this.guardCtx, [topicId]);
    await assertCreatorTopicTargets(this.guardCtx, [topicId]);
    return topic;
  }

  private async assertMessageInTopic(topicId: string, messageId: string) {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.topicId, topicId),
          this.buildWorkspaceWhere(messages),
        ),
      )
      .limit(1);
    if (!row) throw this.createNotFoundError('Message not found in this topic');
  }

  // ==================== Copies ====================

  async clone(topicId: string, { title }: TopicCloneRequest) {
    try {
      await this.findUsableTopic(topicId, 'TOPIC_CREATE');
      const { topic } = await new TopicRepository(this.db, this.userId, this.workspaceId).duplicate(
        topicId,
        title,
      );
      return this.topics().getTopicById(topic.id);
    } catch (error) {
      this.handleServiceError(error, 'Clone topic');
    }
  }

  async fork(topicId: string, { messageId, title }: TopicForkRequest) {
    try {
      await this.findUsableTopic(topicId, 'TOPIC_CREATE');
      await this.assertMessageInTopic(topicId, messageId);
      const { topic } = await new TopicRepository(this.db, this.userId, this.workspaceId).duplicate(
        topicId,
        title,
        { upToMessageId: messageId },
      );
      return this.topics().getTopicById(topic.id);
    } catch (error) {
      this.handleServiceError(error, 'Fork topic');
    }
  }

  async branch(topicId: string, { content, messageId, title }: TopicBranchRequest) {
    try {
      await this.findUsableTopic(topicId, 'TOPIC_CREATE');
      const branch = await new TopicRepository(
        this.db,
        this.userId,
        this.workspaceId,
      ).branchAtMessage(topicId, messageId, { content, title });
      if (!branch) throw this.createNotFoundError('User message not found in this topic');

      return {
        messageId: branch.messageId,
        topic: await this.topics().getTopicById(branch.topic.id),
      };
    } catch (error) {
      this.handleServiceError(error, 'Branch topic');
    }
  }

  // ==================== Transcript / Export / Import ====================

  async transcript(topicId: string, query: TopicTranscriptQuery): Promise<TopicTranscript> {
    try {
      await this.findTopic(topicId, 'TOPIC_READ');
      await assertCanViewTopicTargets(this.guardCtx, [topicId]);

      // A transcript page may exceed the shared list maximum, so the window is resolved here.
      const limit = Math.min(query.limit ?? DEFAULT_TRANSCRIPT_LIMIT, MAX_TRANSCRIPT_LIMIT);
      const offset = query.cursor ? decodeOffsetCursor(query.cursor) : 0;
      const page = await readTopicTranscript(this.guardCtx, {
        includeMessages: true,
        limit,
        offset,
        topicId,
      });

      const total = page.total ?? 0;
      const items = page.items.map((item) => ({
        agentId: item.agentId,
        content: item.content,
        createdAt: toIso(item.createdAt),
        error: (item.error as Record<string, unknown> | null) ?? null,
        id: item.id,
        messageGroupId: item.messageGroupId,
        metadata: (item.metadata as Record<string, unknown> | null) ?? null,
        model: item.model,
        parentId: item.parentId,
        pluginError: (item.pluginError as Record<string, unknown> | null) ?? null,
        provider: item.provider,
        reasoning: (item.reasoning as Record<string, unknown> | null) ?? null,
        role: item.role,
        threadId: item.threadId,
        toolCallId: item.toolCallId,
        tools: (item.tools as Record<string, unknown>[] | null) ?? null,
        usage: (item.usage as Record<string, unknown> | null) ?? null,
      }));
      const pageInfo = buildPageInfo({ limit, offset, returned: items.length, total });
      const topic = {
        id: page.topic.id,
        title: page.topic.title ?? null,
        updatedAt: toIso(page.topic.updatedAt),
      };

      if (query.format === 'markdown') {
        return {
          ...pageInfo,
          format: 'markdown',
          markdown: renderTranscriptMarkdown(topic.title, items, { first: offset === 0 }),
          topic,
          total,
        };
      }
      return { ...pageInfo, format: 'json', items, topic, total };
    } catch (error) {
      this.handleServiceError(error, 'Read topic transcript');
    }
  }

  /** The whole topic in the lossless `version: '2.0'` format `POST /topics/import` reads. */
  async export(topicId: string): Promise<ExportedTopicPayload> {
    try {
      const topic = await this.findTopic(topicId, 'TOPIC_READ');
      await assertCanViewTopicTargets(this.guardCtx, [topicId]);

      const rows = await this.db
        .select({
          content: messages.content,
          createdAt: messages.createdAt,
          error: messages.error,
          id: messages.id,
          metadata: messages.metadata,
          model: messages.model,
          parentId: messages.parentId,
          plugin: {
            apiName: messagePlugins.apiName,
            arguments: messagePlugins.arguments,
            error: messagePlugins.error,
            identifier: messagePlugins.identifier,
            state: messagePlugins.state,
            toolCallId: messagePlugins.toolCallId,
            type: messagePlugins.type,
          },
          provider: messages.provider,
          reasoning: messages.reasoning,
          role: messages.role,
          search: messages.search,
          tools: messages.tools,
          traceId: messages.traceId,
          updatedAt: messages.updatedAt,
        })
        .from(messages)
        .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
        .where(
          and(
            eq(messages.topicId, topicId),
            this.buildWorkspaceWhere(messages),
            // Same exclusion as the transcript: a visitor's turns are not the creator's to export.
            notShareVisitorMessage(),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id));

      const exported = rows.map(
        ({ plugin, ...row }) =>
          compact({
            content: row.content ?? '',
            createdAt: row.createdAt.toISOString(),
            error: row.error as Record<string, unknown> | null,
            id: row.id,
            metadata: row.metadata as Record<string, unknown> | null,
            model: row.model,
            parentId: row.parentId,
            plugin:
              row.role === 'tool' && plugin
                ? {
                    apiName: plugin.apiName,
                    arguments: plugin.arguments,
                    identifier: plugin.identifier,
                    type: plugin.type,
                  }
                : null,
            pluginError: plugin?.error as Record<string, unknown> | null,
            pluginState: plugin?.state as Record<string, unknown> | null,
            provider: row.provider,
            reasoning: row.reasoning as Record<string, unknown> | null,
            role: row.role as ExportedTopicMessage['role'],
            search: row.search as Record<string, unknown> | null,
            tool_call_id: plugin?.toolCallId,
            tools: Array.isArray(row.tools) ? (row.tools as Record<string, unknown>[]) : null,
            traceId: row.traceId,
            updatedAt: row.updatedAt.toISOString(),
          }) as ExportedTopicMessage,
      );

      return compact({
        exportedAt: new Date().toISOString(),
        messages: exported,
        title: topic.title,
        version: '2.0' as const,
      }) as ExportedTopicPayload;
    } catch (error) {
      this.handleServiceError(error, 'Export topic');
    }
  }

  async import({ agentId, data, groupId }: TopicImportRequest) {
    try {
      const permission = await this.resolveOperationPermission('TOPIC_CREATE');
      if (!permission.isPermitted) {
        throw this.createAuthorizationError(permission.message || 'No permission to create topics');
      }

      // The importer writes `agentId` as given: make sure it is an agent of this scope.
      const [agent] = await this.db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), this.buildWorkspaceWhere(agents)))
        .limit(1);
      if (!agent) throw this.createNotFoundError('Agent not found');
      await assertCanUseConversationTargets(this.guardCtx, [{ agentId, groupId }]);

      const imported = Array.isArray(data) ? data : data.messages;
      if (!imported.some((message) => message.role !== 'system')) {
        throw this.createValidationError('Nothing to import: every message is a system message');
      }

      const result = await new TopicImporterRepo(
        this.db,
        this.userId,
        this.workspaceId,
      ).importTopic({ agentId, data: data as any, groupId });

      return {
        messageCount: result.messageCount,
        topic: await this.topics().getTopicById(result.topicId),
      };
    } catch (error) {
      this.handleServiceError(error, 'Import topic');
    }
  }

  // ==================== Search ====================

  async search({ agentId, groupId, onlyMine, q }: TopicSearchQuery) {
    try {
      const permission = await this.resolveOperationPermission('TOPIC_READ');
      if (!permission.isPermitted) {
        throw this.createAuthorizationError(permission.message || 'No permission to read topics');
      }
      if (agentId || groupId) {
        await assertCanViewConversationTargets(this.guardCtx, [{ agentId, groupId }]);
      }

      const ftsSearchRepo = await createFtsSearchRepo({
        db: this.db,
        usage: 'topic_search',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      const rows = await new TopicModel(
        this.db,
        this.userId,
        this.workspaceId,
        ftsSearchRepo,
      ).queryByKeyword(q, { agentId, groupId }, { onlyMine });

      const items = rows.map(projectPublicTopic);
      return { items, total: items.length };
    } catch (error) {
      this.handleServiceError(error, 'Search topics');
    }
  }

  // ==================== Batch ====================

  async batch(request: TopicBatchRequest) {
    try {
      const action: TopicAction = request.action === 'delete' ? 'TOPIC_DELETE' : 'TOPIC_UPDATE';
      const permission = await this.resolveOperationPermission(action);
      if (!permission.isPermitted) {
        throw this.createAuthorizationError(permission.message || 'No permission for these topics');
      }

      const topicModel = new TopicModel(this.db, this.userId, this.workspaceId);
      const rows = await topicModel.findOwnersByIds(request.topicIds);
      for (const userId of new Set(rows.map((row) => row.userId))) {
        await this.assertRowManageable(userId, action, 'topic');
      }
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return { action: request.action, count: 0, movedGoalIds: [] };

      if (request.action === 'delete') {
        await new TrashService(this.db, this.userId, this.workspaceId).trashTopics(ids);
        return { action: request.action, count: ids.length, movedGoalIds: [] };
      }

      // Moving needs `use` on both the source conversations and the target agent.
      await assertCanUseTopicTargets(this.guardCtx, ids);
      await assertCanUseConversationTargets(this.guardCtx, [{ agentId: request.targetAgentId }]);
      await assertCreatorTopicTargets(this.guardCtx, ids);

      // A goal supervised from a moved topic follows it, committed together with the move.
      const movedGoalIds = await this.db.transaction(async (tx) => {
        await new TopicRepository(tx, this.userId, this.workspaceId).batchMoveToAgent(
          ids,
          request.targetAgentId,
        );
        const handoff = new GoalTopicHandoffService(tx, this.userId, this.workspaceId);
        const goals = await handoff.lockFollowing(ids, request.targetAgentId);
        for (const goal of goals)
          await this.assertRowManageable(goal.userId, 'TOPIC_UPDATE', 'goal');
        return handoff.handOver(goals, request.targetAgentId);
      });

      return { action: request.action, count: ids.length, movedGoalIds };
    } catch (error) {
      this.handleServiceError(error, 'Batch topic action');
    }
  }

  // ==================== Share / Read state ====================

  async share(topicId: string, { visibility }: TopicShareRequest): Promise<TopicShare> {
    try {
      await this.findTopic(topicId, 'TOPIC_UPDATE');

      const ctx = {
        agentModel: new AgentModel(this.db, this.userId, this.workspaceId),
        chatGroupModel: new ChatGroupModel(this.db, this.userId, this.workspaceId),
        serverDB: this.db,
        topicModel: new TopicModel(this.db, this.userId, this.workspaceId),
        userId: this.userId,
        workspaceId: this.workspaceId,
      };
      await assertCanManageTopicShare(ctx, topicId, visibility);

      const shares = new TopicShareModel(this.db, this.userId, this.workspaceId);
      const previous = await shares.getByTopicId(topicId);

      if (visibility === 'private') {
        if (previous) {
          await shares.deleteByTopicId(topicId);
          await recordTopicShareAudit(ctx, {
            currentVisibility: 'private',
            previousVisibility: previous.visibility,
            topicId,
          });
        }
        return { shareId: null, topicId, url: null, visibility: 'private' };
      }

      const share = previous
        ? await shares.updateVisibility(topicId, 'link')
        : await shares.create(topicId, 'link');
      if (!share) throw this.createNotFoundError('Topic not found');

      await recordTopicShareAudit(ctx, {
        currentVisibility: 'link',
        previousVisibility: previous?.visibility ?? 'private',
        topicId,
      });

      const origin = appEnv.APP_URL?.replace(/\/$/, '');
      return {
        shareId: share.id,
        topicId,
        url: origin ? `${origin}/share/t/${share.id}` : null,
        visibility: 'link',
      };
    } catch (error) {
      this.handleServiceError(error, 'Share topic');
    }
  }

  /** Clear the topic's unread mark; a no-op when it was not unread. */
  async markRead(topicId: string) {
    try {
      await this.findUsableTopic(topicId, 'TOPIC_UPDATE');
      const [cleared] = await new TopicModel(this.db, this.userId, this.workspaceId).markRead(
        topicId,
      );
      return { id: topicId, wasUnread: !!cleared };
    } catch (error) {
      this.handleServiceError(error, 'Mark topic read');
    }
  }
}
