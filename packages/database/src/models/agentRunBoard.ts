import type { AgentOperationStatus, AgentRunBoardRunningOperation } from '@lobechat/types';
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import {
  agentInterventions,
  agentOperations,
  agents,
  chatGroups,
  messages,
  tasks,
  taskTopics,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from '../utils/softDelete';
import { notChannelTopic } from '../utils/topicVisibility';

/** A run longer than this has no bar worth drawing; it also bounds the index scan. */
const MAX_RUN_SPAN_MS = 24 * 60 * 60_000;
/** Parked rows have no reaper, so an unanswered ask must age out of the board. */
const MAX_WAITING_AGE_MS = 7 * 24 * 60 * 60_000;
const RUN_LIMIT = 500;
const WAITING_RUN_LIMIT = 100;

export interface AgentRunBoardRow {
  agentAvatar: string | null;
  agentBackgroundColor: string | null;
  agentId: string;
  agentName: string | null;
  agentOwnerId: string;
  agentTitle: string | null;
  completedAt: Date | null;
  createdAt: Date;
  errorMessage: string | null;
  errorType: string | null;
  heteroType: string | null;
  id: string;
  /** Empty when the run never wrote an intervention row (client-side asks, self-hosted). */
  interventions: AgentRunBoardInterventionRow[];
  model: string | null;
  runningOperation: AgentRunBoardRunningOperation | null;
  startedAt: Date | null;
  status: AgentOperationStatus;
  taskName: string | null;
  topicId: string | null;
  topicTitle: string | null;
  trigger: string | null;
  updatedAt: Date;
  userId: string;
}

export interface AgentRunBoardInterventionRow {
  createdAt: Date;
  deadline: Date;
  operationId: string;
  status: string;
  userId: string;
}

/**
 * Team-wide read of agent runs. Unlike {@link AgentOperationModel} it answers
 * for the workspace rather than one owner, and `agent_operations` has no
 * visibility of its own, so every read carries the parents' visibility.
 *
 * Private agents, groups and tasks are excluded even for their owner: this is
 * what the workspace can see together, matching the team inbox.
 */
export class AgentRunBoardModel {
  private readonly db: LobeChatDatabase;
  private readonly workspaceId: string;

  constructor(db: LobeChatDatabase, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  listRuns = async ({
    now,
    since,
    involvedUserId,
  }: {
    now: Date;
    since: Date;
    /** Narrows the read to one member's runs *before* the workspace-wide limits. */
    involvedUserId?: string;
  }): Promise<AgentRunBoardRow[]> => {
    // Applied inside both queries: the limits below cap the workspace, so a
    // post-filter would see a board already emptied of the viewer's runs.
    const involvement = involvedUserId ? this.involvedCondition(involvedUserId) : undefined;

    const [windowRows, waitingRows] = await Promise.all([
      this.selectRuns(
        and(
          gte(agentOperations.createdAt, new Date(since.getTime() - MAX_RUN_SPAN_MS)),
          ne(agentOperations.status, 'idle'),
          or(isNull(agentOperations.completedAt), gte(agentOperations.completedAt, since)),
          involvement,
        ),
        RUN_LIMIT,
      ),
      this.selectRuns(
        and(
          gte(agentOperations.createdAt, new Date(now.getTime() - MAX_WAITING_AGE_MS)),
          eq(agentOperations.status, 'waiting_for_human'),
          involvement,
        ),
        WAITING_RUN_LIMIT,
      ),
    ]);

    const rows = [...new Map([...windowRows, ...waitingRows].map((r) => [r.id, r])).values()];
    if (rows.length === 0) return [];

    // Keyed by operation: the workspace column isn't indexed here, and the
    // operation's own unique index already serves this lookup.
    const waitingIds = rows.filter((r) => r.status === 'waiting_for_human').map((r) => r.id);
    if (waitingIds.length === 0) return rows.map((row) => ({ ...row, interventions: [] }));

    const interventions = await this.db
      .select({
        createdAt: agentInterventions.createdAt,
        deadline: agentInterventions.deadline,
        operationId: agentInterventions.operationId,
        status: agentInterventions.status,
        userId: agentInterventions.userId,
      })
      .from(agentInterventions)
      .where(inArray(agentInterventions.operationId, waitingIds));

    const byOperation = Map.groupBy(interventions, (i) => i.operationId);

    return rows.map((row) => ({ ...row, interventions: byOperation.get(row.id) ?? [] }));
  };

  /**
   * Started it, wrote in its topic, or must approve it; in SQL so the
   * limits bound matching runs instead of the unfiltered workspace.
   */
  private involvedCondition = (userId: string) =>
    or(
      // Ran it themselves.
      eq(agentOperations.userId, userId),
      // Wrote in the topic the run belongs to.
      sql`${agentOperations.topicId} IN (
        SELECT ${messages.topicId} FROM ${messages}
        WHERE ${messages.userId} = ${userId}
          AND ${messages.role} = 'user'
          AND ${messages.workspaceId} = ${this.workspaceId}
      )`,
      // Was asked to intervene. The board only loads interventions for waiting
      // rows, so the predicate stays on them to keep both paths in step.
      and(
        eq(agentOperations.status, 'waiting_for_human'),
        sql`${agentOperations.id} IN (
          SELECT ${agentInterventions.operationId} FROM ${agentInterventions}
          WHERE ${agentInterventions.userId} = ${userId}
        )`,
      ),
    );

  private selectRuns = async (condition: ReturnType<typeof and>, limit: number) => {
    const rows = await this.db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentId: agents.id,
        agentName: agents.name,
        agentOwnerId: agents.userId,
        agentTitle: agents.title,
        completedAt: agentOperations.completedAt,
        createdAt: agentOperations.createdAt,
        // Only the message and type: `error` also carries the stack.
        errorMessage: sql<string | null>`${agentOperations.error} ->> 'message'`,
        errorType: sql<string | null>`${agentOperations.error} ->> 'type'`,
        heteroType: sql<string | null>`${topics.metadata} -> 'runningOperation' ->> 'heteroType'`,
        id: agentOperations.id,
        model: agentOperations.model,
        runningOperation: sql<AgentRunBoardRunningOperation | null>`${topics.metadata} -> 'runningOperation'`,
        startedAt: agentOperations.startedAt,
        status: agentOperations.status,
        taskName: tasks.name,
        topicId: agentOperations.topicId,
        topicTitle: topics.title,
        trigger: agentOperations.trigger,
        updatedAt: agentOperations.updatedAt,
        userId: agentOperations.userId,
      })
      .from(agentOperations)
      .innerJoin(agents, eq(agentOperations.agentId, agents.id))
      // Inner on purpose: purging a private task or group nulls these references
      // and drops its visibility snapshot, so a run without its topic can no
      // longer prove it was ever public.
      .innerJoin(topics, eq(agentOperations.topicId, topics.id))
      .leftJoin(chatGroups, eq(agentOperations.chatGroupId, chatGroups.id))
      .leftJoin(tasks, eq(agentOperations.taskId, tasks.id))
      .where(
        and(
          eq(agentOperations.workspaceId, this.workspaceId),
          // Sub-agent runs belong to their parent's bar.
          isNull(agentOperations.parentOperationId),
          isNotNull(agentOperations.agentId),
          eq(agents.workspaceId, this.workspaceId),
          eq(agents.visibility, 'public'),
          notTrashed(agents.isDeleted),
          or(
            isNull(agentOperations.chatGroupId),
            and(eq(chatGroups.visibility, 'public'), notTrashed(chatGroups.isDeleted)),
          ),
          or(isNull(tasks.id), and(eq(tasks.visibility, 'public'), notTrashed(tasks.isDeleted))),
          // The per-run snapshot: a task made public later must not expose
          // runs that happened while it was private.
          sql`NOT EXISTS (SELECT 1 FROM ${taskTopics} WHERE ${taskTopics.topicId} = ${agentOperations.topicId} AND ${taskTopics.visibility} = 'private')`,
          isNull(topics.senderId),
          notTrashed(topics.isDeleted),
          notChannelTopic(),
          condition,
        ),
      )
      .orderBy(desc(agentOperations.createdAt))
      .limit(limit);

    return rows;
  };
}
