import { and, count, eq, sql } from 'drizzle-orm';

import { agentEvalTestCases, type NewAgentEvalTestCase } from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class AgentEvalTestCaseModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalTestCases);

  /**
   * Create a single test case
   */
  create = async (params: Omit<NewAgentEvalTestCase, 'userId'>) => {
    let finalParams: NewAgentEvalTestCase = {
      ...params,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };

    if (finalParams.sortOrder === undefined || finalParams.sortOrder === null) {
      const [maxResult] = await this.db
        .select({ max: sql<number>`COALESCE(MAX(${agentEvalTestCases.sortOrder}), 0)` })
        .from(agentEvalTestCases)
        .where(eq(agentEvalTestCases.datasetId, finalParams.datasetId));

      finalParams = { ...finalParams, sortOrder: maxResult.max + 1 };
    }

    const [result] = await this.db.insert(agentEvalTestCases).values(finalParams).returning();
    return result;
  };

  /**
   * Batch create test cases
   */
  batchCreate = async (cases: Omit<NewAgentEvalTestCase, 'userId'>[]) => {
    const withUserId = cases.map((c) => ({
      ...c,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    }));
    return this.db.insert(agentEvalTestCases).values(withUserId).returning();
  };

  /**
   * Delete a test case by id
   */
  delete = async (id: string) => {
    return this.db
      .delete(agentEvalTestCases)
      .where(and(eq(agentEvalTestCases.id, id), this.ownership()));
  };

  /**
   * Find test case by id
   */
  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalTestCases)
      .where(and(eq(agentEvalTestCases.id, id), this.ownership()))
      .limit(1);
    return result;
  };

  /**
   * Find all test cases by dataset id with pagination
   */
  findByDatasetId = async (datasetId: string, limit?: number, offset?: number) => {
    const query = this.db
      .select()
      .from(agentEvalTestCases)
      .where(and(eq(agentEvalTestCases.datasetId, datasetId), this.ownership()))
      .orderBy(agentEvalTestCases.sortOrder);

    if (limit !== undefined) {
      query.limit(limit);
    }
    if (offset !== undefined) {
      query.offset(offset);
    }

    return query;
  };

  /**
   * Find a test case by the dataset-native case id stored in `metadata.caseId`.
   * Returns undefined when no case carries that external id.
   */
  findByDatasetIdAndCaseId = async (datasetId: string, caseId: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalTestCases)
      .where(
        and(
          eq(agentEvalTestCases.datasetId, datasetId),
          sql`${agentEvalTestCases.metadata} ->> 'caseId' = ${caseId}`,
          this.ownership(),
        ),
      )
      .limit(1);
    return result;
  };

  /**
   * Count test cases by dataset id
   */
  countByDatasetId = async (datasetId: string) => {
    const result = await this.db
      .select({ value: count() })
      .from(agentEvalTestCases)
      .where(and(eq(agentEvalTestCases.datasetId, datasetId), this.ownership()));
    return Number(result[0]?.value) || 0;
  };

  /**
   * Update test case
   */
  update = async (id: string, value: Partial<Omit<NewAgentEvalTestCase, 'userId'>>) => {
    const [result] = await this.db
      .update(agentEvalTestCases)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(agentEvalTestCases.id, id), this.ownership()))
      .returning();
    return result;
  };
}
