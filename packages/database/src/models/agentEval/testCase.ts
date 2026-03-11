import { and, count, eq, sql } from 'drizzle-orm';

import { agentEvalTestCases, type NewAgentEvalTestCase } from '../../schemas';
import { type LobeChatDatabase } from '../../type';

export class AgentEvalTestCaseModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Create a single test case
   */
  create = async (params: Omit<NewAgentEvalTestCase, 'userId'>) => {
    let finalParams: NewAgentEvalTestCase = { ...params, userId: this.userId };

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
    const withUserId = cases.map((c) => ({ ...c, userId: this.userId }));
    return this.db.insert(agentEvalTestCases).values(withUserId).returning();
  };

  /**
   * Delete a test case by id
   */
  delete = async (id: string) => {
    return this.db
      .delete(agentEvalTestCases)
      .where(and(eq(agentEvalTestCases.id, id), eq(agentEvalTestCases.userId, this.userId)));
  };

  /**
   * Find test case by id
   */
  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalTestCases)
      .where(and(eq(agentEvalTestCases.id, id), eq(agentEvalTestCases.userId, this.userId)))
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
      .where(
        and(
          eq(agentEvalTestCases.datasetId, datasetId),
          eq(agentEvalTestCases.userId, this.userId),
        ),
      )
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
   * Count test cases by dataset id
   */
  countByDatasetId = async (datasetId: string) => {
    const result = await this.db
      .select({ value: count() })
      .from(agentEvalTestCases)
      .where(
        and(
          eq(agentEvalTestCases.datasetId, datasetId),
          eq(agentEvalTestCases.userId, this.userId),
        ),
      );
    return Number(result[0]?.value) || 0;
  };

  /**
   * Update test case
   */
  update = async (id: string, value: Partial<Omit<NewAgentEvalTestCase, 'userId'>>) => {
    const [result] = await this.db
      .update(agentEvalTestCases)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(agentEvalTestCases.id, id), eq(agentEvalTestCases.userId, this.userId)))
      .returning();
    return result;
  };
}
