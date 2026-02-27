import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { agentEvalDatasets, agentEvalRuns, type NewAgentEvalRun } from '../../schemas';
import { type LobeChatDatabase } from '../../type';

export class AgentEvalRunModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Create a new run
   */
  create = async (params: Omit<NewAgentEvalRun, 'userId'>) => {
    const [result] = await this.db
      .insert(agentEvalRuns)
      .values({ ...params, userId: this.userId })
      .returning();
    return result;
  };

  /**
   * Query runs with optional filters
   */
  query = async (filter?: {
    benchmarkId?: string;
    datasetId?: string;
    limit?: number;
    offset?: number;
    status?: 'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  }) => {
    const conditions = [eq(agentEvalRuns.userId, this.userId)];

    if (filter?.datasetId) {
      conditions.push(eq(agentEvalRuns.datasetId, filter.datasetId));
    }

    if (filter?.benchmarkId) {
      const datasetIds = this.db
        .select({ id: agentEvalDatasets.id })
        .from(agentEvalDatasets)
        .where(eq(agentEvalDatasets.benchmarkId, filter.benchmarkId));

      conditions.push(inArray(agentEvalRuns.datasetId, datasetIds));
    }

    if (filter?.status) {
      conditions.push(eq(agentEvalRuns.status, filter.status));
    }

    const query = this.db
      .select()
      .from(agentEvalRuns)
      .where(and(...conditions))
      .orderBy(desc(agentEvalRuns.createdAt))
      .$dynamic();

    if (filter?.limit !== undefined) {
      query.limit(filter.limit);
    }

    if (filter?.offset !== undefined) {
      query.offset(filter.offset);
    }

    return query;
  };

  /**
   * Find run by id
   */
  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalRuns)
      .where(and(eq(agentEvalRuns.id, id), eq(agentEvalRuns.userId, this.userId)))
      .limit(1);
    return result;
  };

  /**
   * Update run
   */
  update = async (id: string, value: Partial<NewAgentEvalRun>) => {
    const [result] = await this.db
      .update(agentEvalRuns)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(agentEvalRuns.id, id), eq(agentEvalRuns.userId, this.userId)))
      .returning();
    return result;
  };

  /**
   * Delete run (only user-created runs)
   */
  delete = async (id: string) => {
    return this.db
      .delete(agentEvalRuns)
      .where(and(eq(agentEvalRuns.id, id), eq(agentEvalRuns.userId, this.userId)));
  };

  /**
   * Count runs by dataset id
   */
  countByDatasetId = async (datasetId: string) => {
    const result = await this.db
      .select({ value: count() })
      .from(agentEvalRuns)
      .where(and(eq(agentEvalRuns.datasetId, datasetId), eq(agentEvalRuns.userId, this.userId)));
    return Number(result[0]?.value) || 0;
  };
}
