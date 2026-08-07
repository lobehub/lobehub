import type { CreateThreadParams } from '@lobechat/types';
import { RequestTrigger, ThreadStatus } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, exists, isNotNull, isNull, not, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { ThreadItem } from '../schemas';
import {
  agentOperations,
  agents,
  agentsToSessions,
  chatGroups,
  messages,
  threads,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

const threadTargetAgents = alias(agents, 'thread_target_agents');
const threadTargetGroups = alias(chatGroups, 'thread_target_groups');
const topicTargetAgents = alias(agents, 'thread_topic_target_agents');
const topicTargetGroups = alias(chatGroups, 'thread_topic_target_groups');

/**
 * Per-thread subagent metrics, derived from the child messages at read time
 * (single source of truth = the messages, not a denormalized write). Mirrors
 * `aggregateSubagentMetrics` in the app: SUM of assistant `usage.totalTokens`
 * (prefer the promoted `usage` column, fall back to legacy `metadata.usage`),
 * COUNT of `role='tool'`, and a pinned model. Folded onto `metadata.*` so the
 * subagent inspector chip can read it without hydrating the child messages.
 */
const subagentMetricColumns = {
  _model: sql<
    string | null
  >`MAX(CASE WHEN ${messages.role} = 'assistant' THEN ${messages.model} END)`.as('_sa_model'),
  _totalToolCalls: sql<number>`COUNT(CASE WHEN ${messages.role} = 'tool' THEN 1 END)`.as(
    '_sa_tool_calls',
  ),
  _totalTokens:
    sql<number>`COALESCE(SUM(CASE WHEN ${messages.role} = 'assistant' THEN (COALESCE(${messages.usage}, ${messages.metadata} -> 'usage') ->> 'totalTokens')::numeric END), 0)`.as(
      '_sa_total_tokens',
    ),
};

type ThreadMetricRow = ThreadItem & {
  _model: string | null;
  _totalToolCalls: number | string;
  _totalTokens: number | string;
};

/** Fold the SQL-derived metric columns onto `metadata` and drop the temp keys. */
const foldSubagentMetrics = (rows: ThreadMetricRow[]): ThreadItem[] =>
  rows.map(({ _model, _totalToolCalls, _totalTokens, ...thread }) => {
    const totalToolCalls = Number(_totalToolCalls);
    const totalTokens = Number(_totalTokens);
    return {
      ...thread,
      metadata: {
        ...thread.metadata,
        ...(totalToolCalls > 0 && { totalToolCalls }),
        ...(totalTokens > 0 && { totalTokens }),
        ...(_model && { model: _model }),
      },
    };
  });

const queryColumns = {
  agentId: threads.agentId,
  createdAt: threads.createdAt,
  groupId: threads.groupId,
  id: threads.id,
  metadata: threads.metadata,
  parentThreadId: threads.parentThreadId,
  sourceMessageId: threads.sourceMessageId,
  status: threads.status,
  title: threads.title,
  topicId: threads.topicId,
  type: threads.type,
  updatedAt: threads.updatedAt,
};

export class ThreadModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads);

  /**
   * Threads require access to both their direct target (when present) and the
   * parent topic target or its legacy session mapping. Callers must join the
   * topic and both sets of agent/group aliases before applying this filter.
   */
  private resourceAccess = () => {
    const workspaceId = this.workspaceId;
    const scope = { userId: this.userId, workspaceId };
    const threadGroupAccess = and(
      isNotNull(threads.groupId),
      buildWorkspaceWhere(scope, threadTargetGroups),
    );
    const threadAgentAccess = and(
      isNull(threads.groupId),
      isNotNull(threads.agentId),
      buildWorkspaceWhere(scope, threadTargetAgents),
    );
    const noThreadResource = and(isNull(threads.groupId), isNull(threads.agentId));
    const threadAccess = or(threadGroupAccess, threadAgentAccess, noThreadResource);
    const topicGroupAccess = and(
      isNotNull(topics.groupId),
      buildWorkspaceWhere(scope, topicTargetGroups),
    );
    const topicAgentAccess = and(
      isNull(topics.groupId),
      isNotNull(topics.agentId),
      buildWorkspaceWhere(scope, topicTargetAgents),
    );
    const noTopicResource = and(isNull(topics.groupId), isNull(topics.agentId));

    if (!workspaceId) {
      return and(
        threadAccess,
        or(
          topicGroupAccess,
          topicAgentAccess,
          and(noTopicResource, eq(topics.userId, this.userId)),
        ),
      );
    }

    const linkedWorkspaceAgents = (extraCondition?: SQL) =>
      this.db
        .select({ agentId: agentsToSessions.agentId })
        .from(agentsToSessions)
        .innerJoin(agents, eq(agents.id, agentsToSessions.agentId))
        .where(
          and(
            eq(agentsToSessions.sessionId, topics.sessionId),
            eq(agents.workspaceId, workspaceId),
            extraCondition,
          ),
        );
    const hasLinkedWorkspaceAgent = exists(linkedWorkspaceAgents());

    return and(
      threadAccess,
      or(
        topicGroupAccess,
        topicAgentAccess,
        and(
          noTopicResource,
          isNotNull(topics.sessionId),
          hasLinkedWorkspaceAgent,
          notExists(linkedWorkspaceAgents(not(buildWorkspaceWhere(scope, agents)))),
        ),
        and(
          noTopicResource,
          eq(topics.userId, this.userId),
          or(isNull(topics.sessionId), not(hasLinkedWorkspaceAgent)),
        ),
      ),
    );
  };

  /**
   * In workspace mode `ownership()` matches every member's threads, so a bulk
   * "clear all" would wipe teammates' rows. Destructive sweeps must
   * additionally pin `user_id` to the caller (personal mode is unchanged —
   * ownership already scopes to the user there).
   */
  private mine = () => and(this.ownership(), eq(threads.userId, this.userId));

  create = async (params: CreateThreadParams) => {
    // @ts-ignore
    const [result] = await this.db
      .insert(threads)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { status: ThreadStatus.Active, ...params },
        ),
      )
      .onConflictDoNothing()
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(threads).where(and(eq(threads.id, id), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(threads).where(this.mine());
  };

  query = async () => {
    const data = await this.db
      .select(queryColumns)
      .from(threads)
      .innerJoin(topics, eq(threads.topicId, topics.id))
      .leftJoin(threadTargetAgents, eq(threadTargetAgents.id, threads.agentId))
      .leftJoin(threadTargetGroups, eq(threadTargetGroups.id, threads.groupId))
      .leftJoin(topicTargetAgents, eq(topicTargetAgents.id, topics.agentId))
      .leftJoin(topicTargetGroups, eq(topicTargetGroups.id, topics.groupId))
      .where(and(this.ownership(), this.resourceAccess()))
      .orderBy(desc(threads.updatedAt));

    return data as ThreadItem[];
  };

  queryByTopicId = async (topicId: string) => {
    // LEFT JOIN + GROUP BY threads.id (PK ⇒ Postgres lets us select the plain
    // thread columns alongside the per-thread aggregates). `threadId` join
    // naturally scopes to in-thread rows, excluding the spawning parent.
    const data = await this.db
      .select({ ...queryColumns, ...subagentMetricColumns })
      .from(threads)
      .innerJoin(topics, eq(threads.topicId, topics.id))
      .leftJoin(threadTargetAgents, eq(threadTargetAgents.id, threads.agentId))
      .leftJoin(threadTargetGroups, eq(threadTargetGroups.id, threads.groupId))
      .leftJoin(topicTargetAgents, eq(topicTargetAgents.id, topics.agentId))
      .leftJoin(topicTargetGroups, eq(topicTargetGroups.id, topics.groupId))
      .leftJoin(messages, eq(messages.threadId, threads.id))
      .where(
        and(
          eq(threads.topicId, topicId),
          this.ownership(),
          this.resourceAccess(),
          sql`COALESCE(${threads.metadata} ->> 'onboardingUnderstanding', '') = ''`,
          // NOTICE:
          // Internal Agent Signal and onboarding Understanding runs create
          // isolation threads that must stay out of the user-facing sub-agent
          // attachment list. Ordinary onboarding threads remain visible.
          notExists(
            this.db
              .select({ id: agentOperations.id })
              .from(agentOperations)
              .where(
                and(
                  eq(agentOperations.threadId, threads.id),
                  eq(agentOperations.trigger, RequestTrigger.AgentSignal),
                ),
              ),
          ),
        ),
      )
      .groupBy(threads.id)
      .orderBy(desc(threads.updatedAt));

    return foldSubagentMetrics(data as ThreadMetricRow[]);
  };

  findById = async (id: string) => {
    return this.db.query.threads.findFirst({
      where: and(eq(threads.id, id), this.ownership()),
    });
  };

  update = async (id: string, value: Partial<ThreadItem>) => {
    return this.db
      .update(threads)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(threads.id, id), this.ownership()));
  };
}
