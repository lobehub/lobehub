import { and, count, desc, eq, getTableColumns, isNull, or, sql } from 'drizzle-orm';

import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalTestCases,
  type NewAgentEvalBenchmark,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class AgentEvalBenchmarkModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Ownership predicate: rows the current actor can see/edit. Includes
   * workspace-scoped or personal rows AND system rows (`userId IS NULL`).
   */
  private ownership = () =>
    or(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        agentEvalBenchmarks,
      ),
      isNull(agentEvalBenchmarks.userId),
    );

  /** Mutate-only predicate excluding system rows. */
  private mutableOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentEvalBenchmarks,
    );

  /**
   * Create a new benchmark
   */
  create = async (params: NewAgentEvalBenchmark) => {
    const [result] = await this.db
      .insert(agentEvalBenchmarks)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();
    return result;
  };

  /**
   * Delete a benchmark by id (only user-created benchmarks)
   */
  delete = async (id: string) => {
    return this.db
      .delete(agentEvalBenchmarks)
      .where(
        and(
          eq(agentEvalBenchmarks.id, id),
          eq(agentEvalBenchmarks.isSystem, false),
          this.mutableOwnership(),
        ),
      );
  };

  /**
   * Query benchmarks (system + user/workspace-created)
   * @param includeSystem - Whether to include system benchmarks (default: true)
   */
  query = async (includeSystem = true) => {
    const userCondition = this.ownership();
    const conditions = includeSystem
      ? userCondition
      : and(eq(agentEvalBenchmarks.isSystem, false), this.ownership());

    const datasetCountSq = this.db
      .select({
        benchmarkId: agentEvalDatasets.benchmarkId,
        count: count().as('dataset_count'),
      })
      .from(agentEvalDatasets)
      .where(
        buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          agentEvalDatasets,
        ),
      )
      .groupBy(agentEvalDatasets.benchmarkId)
      .as('dc');

    const testCaseCountSq = this.db
      .select({
        benchmarkId: agentEvalDatasets.benchmarkId,
        count: count().as('test_case_count'),
      })
      .from(agentEvalTestCases)
      .innerJoin(agentEvalDatasets, eq(agentEvalTestCases.datasetId, agentEvalDatasets.id))
      .where(
        buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          agentEvalDatasets,
        ),
      )
      .groupBy(agentEvalDatasets.benchmarkId)
      .as('tc');

    const runCountSq = this.db
      .select({
        benchmarkId: agentEvalDatasets.benchmarkId,
        count: count().as('run_count'),
      })
      .from(agentEvalRuns)
      .innerJoin(agentEvalDatasets, eq(agentEvalRuns.datasetId, agentEvalDatasets.id))
      .where(
        buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalRuns),
      )
      .groupBy(agentEvalDatasets.benchmarkId)
      .as('rc');

    const rows = await this.db
      .select({
        ...getTableColumns(agentEvalBenchmarks),
        datasetCount: sql<number>`COALESCE(${datasetCountSq.count}, 0)`.as('datasetCount'),
        testCaseCount: sql<number>`COALESCE(${testCaseCountSq.count}, 0)`.as('testCaseCount'),
        runCount: sql<number>`COALESCE(${runCountSq.count}, 0)`.as('runCount'),
      })
      .from(agentEvalBenchmarks)
      .leftJoin(datasetCountSq, eq(agentEvalBenchmarks.id, datasetCountSq.benchmarkId))
      .leftJoin(testCaseCountSq, eq(agentEvalBenchmarks.id, testCaseCountSq.benchmarkId))
      .leftJoin(runCountSq, eq(agentEvalBenchmarks.id, runCountSq.benchmarkId))
      .where(conditions)
      .orderBy(desc(agentEvalBenchmarks.createdAt));

    // Fetch recent runs for each benchmark
    const benchmarksWithRuns = await Promise.all(
      rows.map(async (row) => {
        const recentRuns = await this.db
          .select()
          .from(agentEvalRuns)
          .innerJoin(agentEvalDatasets, eq(agentEvalRuns.datasetId, agentEvalDatasets.id))
          .where(
            and(
              eq(agentEvalDatasets.benchmarkId, row.id),
              buildWorkspaceWhere(
                { userId: this.userId, workspaceId: this.workspaceId },
                agentEvalRuns,
              ),
            ),
          )
          .orderBy(desc(agentEvalRuns.createdAt))
          .limit(5);

        return {
          id: row.id,
          identifier: row.identifier,
          name: row.name,
          description: row.description,
          rubrics: row.rubrics,
          referenceUrl: row.referenceUrl,
          metadata: row.metadata,
          tags: (row as any).tags,
          isSystem: row.isSystem,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          datasetCount: Number(row.datasetCount),
          runCount: Number(row.runCount),
          testCaseCount: Number(row.testCaseCount),
          recentRuns: recentRuns.map((r) => r.agent_eval_runs),
        };
      }),
    );

    return benchmarksWithRuns;
  };

  /**
   * Find benchmark by id
   */
  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalBenchmarks)
      .where(and(eq(agentEvalBenchmarks.id, id), this.ownership()))
      .limit(1);
    return result;
  };

  /**
   * Find benchmark by identifier
   */
  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalBenchmarks)
      .where(and(eq(agentEvalBenchmarks.identifier, identifier), this.ownership()))
      .limit(1);
    return result;
  };

  /**
   * Update benchmark (only user-created benchmarks)
   */
  update = async (id: string, value: Partial<NewAgentEvalBenchmark>) => {
    const [result] = await this.db
      .update(agentEvalBenchmarks)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(
          eq(agentEvalBenchmarks.id, id),
          eq(agentEvalBenchmarks.isSystem, false),
          this.mutableOwnership(),
        ),
      )
      .returning();
    return result;
  };
}
