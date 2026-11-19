import { and, eq } from 'drizzle-orm';

import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertCanViewConversationTargets } from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { UsageRecordService } from '@/server/services/usage';
import type { AgentUsageStats } from '@/types/usage/usageRecord';

import { BaseService } from '../common/base.service';
import type { AgentUsageQuery } from '../types/usage.type';

/**
 * Per-agent usage for the REST API — the same aggregation as the agent usage
 * panel (`usage.getAgentUsageStats`). Unlike the tRPC procedure, the agent is
 * resolved first: one that is not the caller's (or not in the request's
 * workspace) answers 404 instead of an empty series, and a workspace agent
 * needs view access.
 */
export class AgentUsageRestService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  async getAgentUsage(agentId: string, query: AgentUsageQuery): Promise<AgentUsageStats> {
    const agent = await this.db.query.agents.findFirst({
      columns: { id: true },
      where: and(eq(agents.id, agentId), this.buildWorkspaceWhere(agents)),
    });
    if (!agent) throw this.createNotFoundError('Agent not found');

    await assertCanViewConversationTargets(
      { db: this.db, userId: this.userId, workspaceId: this.workspaceId },
      [{ agentId }],
    );

    return new UsageRecordService(this.db, this.userId, this.workspaceId).getAgentUsageStats(
      agentId,
      query.startAt,
      query.endAt,
      query.granularity,
    );
  }
}
