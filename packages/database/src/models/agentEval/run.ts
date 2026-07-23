import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { agentEvalDatasets, agentEvalRuns, type NewAgentEvalRun } from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class AgentEvalRunModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalRuns);

  /**
   * Create a new run
   */
  create = async (params: Omit<NewAgentEvalRun, 'userId'>) => {
    const [result] = await this.db
      .insert(agentEvalRuns)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();
    return result;
  };

  /**
   * Query runs with optional filters
   */
  query = async (filter?: {
    benchmarkId?: string;
    datasetId?: string;
    experimentId?: string;
    limit?: number;
    offset?: number;
    status?: 'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'aborted' | 'external';
  }) => {
    const conditions = [this.ownership()];

    if (filter?.datasetId) {
      conditions.push(eq(agentEvalRuns.datasetId, filter.datasetId));
    }

    if (filter?.experimentId) {
      conditions.push(eq(agentEvalRuns.experimentId, filter.experimentId));
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
      .where(and(eq(agentEvalRuns.id, id), this.ownership()))
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
      .where(and(eq(agentEvalRuns.id, id), this.ownership()))
      .returning();
    return result;
  };

  /**
   * Atomically claim a pending run (pending -> running) via a single
   * conditional update. Returns the updated run, or undefined when the run is
   * not owned / not currently pending (already claimed or terminal).
   */
  claim = async (id: string) => {
    const [result] = await this.db
      .update(agentEvalRuns)
      .set({ startedAt: new Date(), status: 'running', updatedAt: new Date() })
      .where(and(eq(agentEvalRuns.id, id), eq(agentEvalRuns.status, 'pending'), this.ownership()))
      .returning();
    return result;
  };

  /**
   * Delete run (only user-created runs)
   */
  delete = async (id: string) => {
    return this.db.delete(agentEvalRuns).where(and(eq(agentEvalRuns.id, id), this.ownership()));
  };

  /**
   * Count runs by dataset id
   */
  countByDatasetId = async (datasetId: string) => {
    const result = await this.db
      .select({ value: count() })
      .from(agentEvalRuns)
      .where(and(eq(agentEvalRuns.datasetId, datasetId), this.ownership()));
    return Number(result[0]?.value) || 0;
  };
}
