import { and, asc, count, desc, eq, isNull, or } from 'drizzle-orm';

import { agentEvalDatasets, agentEvalTestCases, type NewAgentEvalDataset } from '../../schemas';
import { type LobeChatDatabase } from '../../type';

export class AgentEvalDatasetModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Create a new dataset
   */
  create = async (params: NewAgentEvalDataset) => {
    const [result] = await this.db
      .insert(agentEvalDatasets)
      .values({ ...params, userId: this.userId })
      .returning();
    return result;
  };

  /**
   * Delete a dataset by id
   */
  delete = async (id: string) => {
    return this.db
      .delete(agentEvalDatasets)
      .where(and(eq(agentEvalDatasets.id, id), eq(agentEvalDatasets.userId, this.userId)));
  };

  /**
   * Query datasets (system + user-owned) with test case counts
   * @param benchmarkId - Optional benchmark filter
   */
  query = async (benchmarkId?: string) => {
    const conditions = [
      or(eq(agentEvalDatasets.userId, this.userId), isNull(agentEvalDatasets.userId)),
    ];

    if (benchmarkId) {
      conditions.push(eq(agentEvalDatasets.benchmarkId, benchmarkId));
    }

    return this.db
      .select({
        benchmarkId: agentEvalDatasets.benchmarkId,
        createdAt: agentEvalDatasets.createdAt,
        description: agentEvalDatasets.description,
        id: agentEvalDatasets.id,
        identifier: agentEvalDatasets.identifier,
        metadata: agentEvalDatasets.metadata,
        name: agentEvalDatasets.name,
        testCaseCount: count(agentEvalTestCases.id).as('testCaseCount'),
        updatedAt: agentEvalDatasets.updatedAt,
        userId: agentEvalDatasets.userId,
      })
      .from(agentEvalDatasets)
      .leftJoin(agentEvalTestCases, eq(agentEvalDatasets.id, agentEvalTestCases.datasetId))
      .where(and(...conditions))
      .groupBy(agentEvalDatasets.id)
      .orderBy(desc(agentEvalDatasets.createdAt));
  };

  /**
   * Find dataset by id (with test cases)
   */
  findById = async (id: string) => {
    const [dataset] = await this.db
      .select()
      .from(agentEvalDatasets)
      .where(
        and(
          eq(agentEvalDatasets.id, id),
          or(eq(agentEvalDatasets.userId, this.userId), isNull(agentEvalDatasets.userId)),
        ),
      )
      .limit(1);

    if (!dataset) return undefined;

    const testCases = await this.db
      .select()
      .from(agentEvalTestCases)
      .where(eq(agentEvalTestCases.datasetId, id))
      .orderBy(asc(agentEvalTestCases.sortOrder));

    return { ...dataset, testCases };
  };

  /**
   * Update dataset
   */
  update = async (id: string, value: Partial<NewAgentEvalDataset>) => {
    const [result] = await this.db
      .update(agentEvalDatasets)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(agentEvalDatasets.id, id), eq(agentEvalDatasets.userId, this.userId)))
      .returning();
    return result;
  };
}
