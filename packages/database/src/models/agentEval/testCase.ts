import type { EvalTestCaseContent } from '@lobechat/types';
import { and, count, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { agentEvalTestCases, type NewAgentEvalTestCase } from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../../utils/workspace';
import {
  assertEvalDatasetCasesMutable,
  assertReadableEvalEnvironments,
  assertWritableEvalDatasets,
} from './datasetAccess';

export const isRetiredEvalTestCase = (testCase: { metadata?: Record<string, unknown> | null }) =>
  testCase.metadata?.retired === true;

/** Retired rows remain available by id for historical runs, but leave the runnable catalog. */
export const activeEvalTestCases = () =>
  sql`${agentEvalTestCases.metadata} -> 'retired' IS DISTINCT FROM 'true'::jsonb`;

export class AgentEvalTestCaseModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = normalizeWorkspaceId(workspaceId) ?? undefined;
  }

  private scope = () => ({ userId: this.userId, workspaceId: this.workspaceId });

  /**
   * Rows the actor can read: own/workspace cases and system cases
   * (`userId IS NULL`, the built-in case sets every user can run).
   */
  private ownership = () =>
    or(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        agentEvalTestCases,
      ),
      isNull(agentEvalTestCases.userId),
    );

  /** Rows the actor can change: own/workspace cases only, never system cases. */
  private mutableOwnership = () =>
    and(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        agentEvalTestCases,
      ),
      isNotNull(agentEvalTestCases.userId),
    );

  /**
   * Create a single test case
   */
  create = async (params: Omit<NewAgentEvalTestCase, 'userId'>) => {
    return this.db.transaction(async (tx) => {
      const datasets = await assertWritableEvalDatasets(tx, this.scope(), [params.datasetId]);
      await assertEvalDatasetCasesMutable(tx, datasets);
      await assertReadableEvalEnvironments(tx, this.scope(), [params.environmentId]);
      let finalParams: NewAgentEvalTestCase = {
        ...params,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      };

      if (finalParams.sortOrder === undefined || finalParams.sortOrder === null) {
        const [maxResult] = await tx
          .select({ max: sql<number>`COALESCE(MAX(${agentEvalTestCases.sortOrder}), 0)` })
          .from(agentEvalTestCases)
          .where(eq(agentEvalTestCases.datasetId, finalParams.datasetId));

        finalParams = { ...finalParams, sortOrder: maxResult.max + 1 };
      }

      const [result] = await tx.insert(agentEvalTestCases).values(finalParams).returning();
      return result;
    });
  };

  /**
   * Batch create test cases
   */
  batchCreate = async (cases: Omit<NewAgentEvalTestCase, 'userId'>[]) => {
    if (cases.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const datasets = await assertWritableEvalDatasets(
        tx,
        this.scope(),
        cases.map((c) => c.datasetId),
      );
      await assertEvalDatasetCasesMutable(tx, datasets);
      await assertReadableEvalEnvironments(
        tx,
        this.scope(),
        cases.map((c) => c.environmentId),
      );
      const withUserId = cases.map((c) => ({
        ...c,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      }));
      return tx.insert(agentEvalTestCases).values(withUserId).returning();
    });
  };

  /**
   * Delete a test case by id
   */
  delete = async (id: string) => {
    return this.db.transaction(async (tx) => {
      const [testCase] = await tx
        .select()
        .from(agentEvalTestCases)
        .where(and(eq(agentEvalTestCases.id, id), this.mutableOwnership()));
      if (testCase) {
        const datasets = await assertWritableEvalDatasets(tx, this.scope(), [testCase.datasetId]);
        await assertEvalDatasetCasesMutable(tx, datasets);
      }
      return tx
        .delete(agentEvalTestCases)
        .where(and(eq(agentEvalTestCases.id, id), this.mutableOwnership()));
    });
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
      .where(
        and(eq(agentEvalTestCases.datasetId, datasetId), this.ownership(), activeEvalTestCases()),
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
          activeEvalTestCases(),
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
      .where(
        and(eq(agentEvalTestCases.datasetId, datasetId), this.ownership(), activeEvalTestCases()),
      );
    return Number(result[0]?.value) || 0;
  };

  /**
   * Update test case
   */
  update = async (
    id: string,
    value: Omit<
      Partial<NewAgentEvalTestCase>,
      'content' | 'datasetId' | 'id' | 'userId' | 'workspaceId'
    > & {
      content?: Partial<EvalTestCaseContent>;
    },
  ) => {
    return this.db.transaction(async (tx) => {
      const [testCase] = await tx
        .select()
        .from(agentEvalTestCases)
        .where(and(eq(agentEvalTestCases.id, id), this.mutableOwnership()));
      if (!testCase) return undefined;
      const datasets = await assertWritableEvalDatasets(tx, this.scope(), [testCase.datasetId]);
      await assertEvalDatasetCasesMutable(tx, datasets);
      await assertReadableEvalEnvironments(tx, this.scope(), [value.environmentId]);
      const { content, ...data } = value;
      const [result] = await tx
        .update(agentEvalTestCases)
        .set({
          ...data,
          ...(content !== undefined && {
            content: sql`COALESCE(${agentEvalTestCases.content}, '{}'::jsonb) || ${JSON.stringify(content)}::jsonb`,
          }),
          updatedAt: new Date(),
        })
        .where(and(eq(agentEvalTestCases.id, id), this.mutableOwnership()))
        .returning();
      return result;
    });
  };
}
