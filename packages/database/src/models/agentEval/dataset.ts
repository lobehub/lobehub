import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import {
  agentEvalDatasets,
  agentEvalTestCases,
  type NewAgentEvalDataset,
  type NewAgentEvalTestCase,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../../utils/workspace';
import {
  AgentEvalDatasetWriteError,
  assertReadableEvalEnvironments,
  isFixedLobeBenchDataset,
} from './datasetAccess';
import { activeEvalTestCases } from './testCase';

interface QueryDatasetsFilters {
  benchmarkId?: string;
  benchmarkIds?: string[];
  sourceExperimentId?: string;
}

const fixedDatasetMetadata = (metadata?: Record<string, unknown> | null) => ({
  ...metadata,
  custom: true,
  kind: 'lobe-bench',
});

export class AgentEvalDatasetModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = normalizeWorkspaceId(workspaceId) ?? undefined;
  }

  /** Includes system datasets (`userId IS NULL`) on read. */
  private ownership = () =>
    or(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        agentEvalDatasets,
      ),
      isNull(agentEvalDatasets.userId),
    );

  /** Mutate-only predicate excluding system rows. */
  private mutableOwnership = () =>
    and(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        agentEvalDatasets,
      ),
      isNotNull(agentEvalDatasets.userId),
    );

  /**
   * Create a new dataset
   */
  create = async (
    params: NewAgentEvalDataset,
    cases?: Omit<NewAgentEvalTestCase, 'datasetId' | 'userId' | 'workspaceId'>[],
  ) =>
    this.db.transaction(async (tx) => {
      const fixed = await isFixedLobeBenchDataset(tx, params);
      await assertReadableEvalEnvironments(
        tx,
        { userId: this.userId, workspaceId: this.workspaceId },
        cases?.map((testCase) => testCase.environmentId) ?? [],
      );
      const [result] = await tx
        .insert(agentEvalDatasets)
        .values({
          ...params,
          ...(fixed && { metadata: fixedDatasetMetadata(params.metadata) }),
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })
        .returning();
      if (cases?.length) {
        await tx.insert(agentEvalTestCases).values(
          cases.map((testCase, index) => ({
            ...testCase,
            datasetId: result.id,
            sortOrder: testCase.sortOrder ?? index + 1,
            userId: this.userId,
            workspaceId: this.workspaceId ?? null,
          })),
        );
      }
      return result;
    });

  /**
   * Delete a dataset by id
   */
  delete = async (id: string) => {
    return this.db
      .delete(agentEvalDatasets)
      .where(and(eq(agentEvalDatasets.id, id), this.mutableOwnership()));
  };

  /**
   * Query datasets (system + user/workspace-owned) with test case counts
   * @param filters - Optional benchmark / experiment filters
   */
  query = async (filters?: QueryDatasetsFilters) => {
    const { benchmarkId, benchmarkIds, sourceExperimentId } = filters || {};
    const conditions = [this.ownership()];

    if (benchmarkId) {
      conditions.push(eq(agentEvalDatasets.benchmarkId, benchmarkId));
    }

    if (benchmarkIds && benchmarkIds.length > 0) {
      conditions.push(inArray(agentEvalDatasets.benchmarkId, benchmarkIds));
    }

    if (sourceExperimentId) {
      conditions.push(eq(agentEvalDatasets.sourceExperimentId, sourceExperimentId));
      // Scoped subsets are experiment-owned; exclude system rows from this scope.
      conditions.push(this.mutableOwnership());
    }

    return this.db
      .select({
        benchmarkId: agentEvalDatasets.benchmarkId,
        createdAt: agentEvalDatasets.createdAt,
        description: agentEvalDatasets.description,
        evalConfig: agentEvalDatasets.evalConfig,
        evalMode: agentEvalDatasets.evalMode,
        id: agentEvalDatasets.id,
        identifier: agentEvalDatasets.identifier,
        metadata: agentEvalDatasets.metadata,
        name: agentEvalDatasets.name,
        sourceExperimentId: agentEvalDatasets.sourceExperimentId,
        testCaseCount: count(agentEvalTestCases.id).as('testCaseCount'),
        updatedAt: agentEvalDatasets.updatedAt,
        userId: agentEvalDatasets.userId,
      })
      .from(agentEvalDatasets)
      .leftJoin(
        agentEvalTestCases,
        and(eq(agentEvalDatasets.id, agentEvalTestCases.datasetId), activeEvalTestCases()),
      )
      .where(and(...conditions))
      .groupBy(agentEvalDatasets.id)
      .orderBy(desc(agentEvalDatasets.createdAt));
  };

  /**
   * Read-only paginated list (system + user/workspace-owned), without the
   * test-case join used by `query`
   */
  queryList = async (filter?: { benchmarkId?: string; limit?: number; offset?: number }) => {
    const conditions = [this.ownership()];

    if (filter?.benchmarkId) {
      conditions.push(eq(agentEvalDatasets.benchmarkId, filter.benchmarkId));
    }

    const query = this.db
      .select()
      .from(agentEvalDatasets)
      .where(and(...conditions))
      .orderBy(desc(agentEvalDatasets.createdAt))
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
   * Count datasets (system + user/workspace-owned) with the same predicates as `queryList`
   */
  count = async (filter?: { benchmarkId?: string }) => {
    const conditions = [this.ownership()];

    if (filter?.benchmarkId) {
      conditions.push(eq(agentEvalDatasets.benchmarkId, filter.benchmarkId));
    }

    const result = await this.db
      .select({ value: count() })
      .from(agentEvalDatasets)
      .where(and(...conditions));
    return Number(result[0]?.value) || 0;
  };

  /**
   * Find dataset by id (with test cases)
   */
  findById = async (id: string) => {
    const [dataset] = await this.db
      .select()
      .from(agentEvalDatasets)
      .where(and(eq(agentEvalDatasets.id, id), this.ownership()))
      .limit(1);

    if (!dataset) return undefined;

    const testCases = await this.db
      .select()
      .from(agentEvalTestCases)
      .where(and(eq(agentEvalTestCases.datasetId, id), activeEvalTestCases()))
      .orderBy(asc(agentEvalTestCases.sortOrder));

    return { ...dataset, testCases };
  };

  /**
   * Update dataset
   */
  update = async (id: string, value: Partial<NewAgentEvalDataset>) => {
    return this.db.transaction(async (tx) => {
      const [dataset] = await tx
        .select()
        .from(agentEvalDatasets)
        .where(and(eq(agentEvalDatasets.id, id), this.mutableOwnership()))
        .for('update');
      if (!dataset) return undefined;
      const fixed = await isFixedLobeBenchDataset(tx, dataset);
      if (fixed) {
        for (const [key, next] of Object.entries(value)) {
          if (next === undefined || ['benchmarkId', 'description', 'name'].includes(key)) continue;
          const previous = dataset[key as keyof typeof dataset];
          const unchanged =
            key === 'metadata' ? isEqual(next ?? {}, previous ?? {}) : isEqual(next, previous);
          if (!unchanged) {
            throw new AgentEvalDatasetWriteError(
              'Lobe Bench dataset configuration is fixed; create a new dataset instead',
            );
          }
        }
      }
      // Persist the classification on entry, and retain it when moved out, so
      // changing benchmark or omitting client metadata cannot unfreeze cases.
      const staysFixed = fixed || (await isFixedLobeBenchDataset(tx, { ...dataset, ...value }));
      const [result] = await tx
        .update(agentEvalDatasets)
        .set({
          ...value,
          ...(staysFixed && { metadata: fixedDatasetMetadata(value.metadata ?? dataset.metadata) }),
          updatedAt: new Date(),
        })
        .where(and(eq(agentEvalDatasets.id, id), this.mutableOwnership()))
        .returning();
      return result;
    });
  };
}
