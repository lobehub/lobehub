import type { AgentLikeStat, AgentLikeSummaries } from '@lobechat/types';
import { and, count, eq, ne, or, sql } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { agentLikes } from '../schemas/agentLike';
import type { LobeChatDatabase } from '../type';

export const AGENT_LIKE_WORKSPACE_REQUIRED =
  'Agent likes are workspace-scoped; a workspaceId is required';
export const AGENT_LIKE_AGENT_NOT_FOUND = 'Agent not found in current workspace';

export class AgentLikeModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private requireWorkspaceId = (): string => {
    if (!this.workspaceId) throw new Error(AGENT_LIKE_WORKSPACE_REQUIRED);
    return this.workspaceId;
  };

  /**
   * Validate the agent inside the caller's transaction while holding a share
   * lock, so a like serializes against a concurrent transfer (whose UPDATE
   * waits for this transaction) instead of landing on the old workspace.
   * Share rather than update: concurrent likes on one agent need not queue.
   */
  private lockAgent = async (tx: LobeChatDatabase, agentId: string) => {
    const workspaceId = this.requireWorkspaceId();
    const [agent] = await tx
      .select({ id: agents.id, workspaceId: agents.workspaceId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1)
      .for('share');

    if (!agent || agent.workspaceId !== workspaceId) throw new Error(AGENT_LIKE_AGENT_NOT_FOUND);
    return workspaceId;
  };

  /** Rows from before a transfer carry the old workspace and are not counted. */
  private statInTx = async (
    tx: LobeChatDatabase,
    agentId: string,
    workspaceId: string,
    liked: boolean,
  ): Promise<AgentLikeStat> => {
    const [row] = await tx
      .select({ total: count() })
      .from(agentLikes)
      .where(and(eq(agentLikes.agentId, agentId), eq(agentLikes.workspaceId, workspaceId)));

    /* v8 ignore next -- unreachable: count() without GROUP BY always returns exactly one row */
    return { liked, total: row?.total ?? 0 };
  };

  async like(agentId: string): Promise<AgentLikeStat> {
    return this.db.transaction(async (tx) => {
      const runner = tx as LobeChatDatabase;
      const workspaceId = await this.lockAgent(runner, agentId);

      // A row left behind by a transfer is re-homed rather than duplicated.
      await tx
        .insert(agentLikes)
        .values({ agentId, userId: this.userId, workspaceId })
        .onConflictDoUpdate({
          set: { createdAt: new Date(), workspaceId },
          setWhere: ne(agentLikes.workspaceId, workspaceId),
          target: [agentLikes.agentId, agentLikes.userId],
        });

      return this.statInTx(runner, agentId, workspaceId, true);
    });
  }

  async unlike(agentId: string): Promise<AgentLikeStat> {
    return this.db.transaction(async (tx) => {
      const runner = tx as LobeChatDatabase;
      const workspaceId = await this.lockAgent(runner, agentId);

      await tx
        .delete(agentLikes)
        .where(and(eq(agentLikes.agentId, agentId), eq(agentLikes.userId, this.userId)));

      return this.statInTx(runner, agentId, workspaceId, false);
    });
  }

  /**
   * Like stats for every agent in the workspace the caller can see: shared
   * agents plus the caller's own private ones. One grouped read for the whole
   * badge wall instead of a request per card.
   */
  async summaries(): Promise<AgentLikeSummaries> {
    const workspaceId = this.requireWorkspaceId();
    const rows = await this.db
      .select({
        agentId: agentLikes.agentId,
        liked: sql<boolean>`bool_or(${agentLikes.userId} = ${this.userId})`,
        total: count(),
      })
      .from(agentLikes)
      .innerJoin(
        agents,
        and(eq(agents.id, agentLikes.agentId), eq(agents.workspaceId, agentLikes.workspaceId)),
      )
      .where(
        and(
          eq(agentLikes.workspaceId, workspaceId),
          or(ne(agents.visibility, 'private'), eq(agents.userId, this.userId)),
        ),
      )
      .groupBy(agentLikes.agentId);

    return Object.fromEntries(
      rows.map((row) => [row.agentId, { liked: Boolean(row.liked), total: row.total }]),
    );
  }
}
