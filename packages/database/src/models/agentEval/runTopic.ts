import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';

import {
  agentEvalRuns,
  type AgentEvalRunTopicItem,
  agentEvalRunTopics,
  agentEvalTestCases,
  type NewAgentEvalRunTopic,
  topics,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class AgentEvalRunTopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalRunTopics);

  /**
   * Batch create run-topic associations
   */
  batchCreate = async (items: Omit<NewAgentEvalRunTopic, 'userId'>[]) => {
    if (items.length === 0) return [];
    const withUserId = items.map((item) => ({
      ...item,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    }));
    return this.db.insert(agentEvalRunTopics).values(withUserId).returning();
  };

  /**
   * Find all topics for a run (with TestCase and Topic details)
   */
  findByRunId = async (runId: string, pagination?: { limit?: number; offset?: number }) => {
    const query = this.db
      .select({
        createdAt: agentEvalRunTopics.createdAt,
        evalResult: agentEvalRunTopics.evalResult,
        passed: agentEvalRunTopics.passed,
        runId: agentEvalRunTopics.runId,
        score: agentEvalRunTopics.score,
        status: agentEvalRunTopics.status,
        testCase: agentEvalTestCases,
        testCaseId: agentEvalRunTopics.testCaseId,
        topic: topics,
        topicId: agentEvalRunTopics.topicId,
      })
      .from(agentEvalRunTopics)
      .leftJoin(agentEvalTestCases, eq(agentEvalRunTopics.testCaseId, agentEvalTestCases.id))
      .leftJoin(topics, eq(agentEvalRunTopics.topicId, topics.id))
      .where(and(eq(agentEvalRunTopics.runId, runId), this.ownership()))
      .orderBy(asc(agentEvalTestCases.sortOrder), asc(agentEvalRunTopics.topicId))
      .$dynamic();

    if (pagination?.limit !== undefined) {
      query.limit(pagination.limit);
    }

    if (pagination?.offset !== undefined) {
      query.offset(pagination.offset);
    }

    return query;
  };

  /**
   * Count topics for a run
   */
  countByRunId = async (runId: string) => {
    const result = await this.db
      .select({ value: count() })
      .from(agentEvalRunTopics)
      .where(and(eq(agentEvalRunTopics.runId, runId), this.ownership()));
    return Number(result[0]?.value) || 0;
  };

  /**
   * Delete all run-topic associations for a run
   */
  deleteByRunId = async (runId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(and(eq(agentEvalRunTopics.runId, runId), this.ownership()));
  };

  /**
   * Find all runs that used a specific test case
   */
  findByTestCaseId = async (testCaseId: string) => {
    const rows = await this.db
      .select({
        createdAt: agentEvalRunTopics.createdAt,
        evalResult: agentEvalRunTopics.evalResult,
        passed: agentEvalRunTopics.passed,
        run: agentEvalRuns,
        runId: agentEvalRunTopics.runId,
        score: agentEvalRunTopics.score,
        testCaseId: agentEvalRunTopics.testCaseId,
        topic: topics,
        topicId: agentEvalRunTopics.topicId,
      })
      .from(agentEvalRunTopics)
      .leftJoin(agentEvalRuns, eq(agentEvalRunTopics.runId, agentEvalRuns.id))
      .leftJoin(topics, eq(agentEvalRunTopics.topicId, topics.id))
      .where(and(eq(agentEvalRunTopics.testCaseId, testCaseId), this.ownership()))
      .orderBy(desc(agentEvalRunTopics.createdAt));

    return rows;
  };

  /**
   * Find a specific run-topic association by run and test case
   */
  findByRunAndTestCase = async (runId: string, testCaseId: string) => {
    const [row] = await this.db
      .select({
        createdAt: agentEvalRunTopics.createdAt,
        evalResult: agentEvalRunTopics.evalResult,
        passed: agentEvalRunTopics.passed,
        runId: agentEvalRunTopics.runId,
        score: agentEvalRunTopics.score,
        status: agentEvalRunTopics.status,
        testCase: agentEvalTestCases,
        testCaseId: agentEvalRunTopics.testCaseId,
        topic: topics,
        topicId: agentEvalRunTopics.topicId,
      })
      .from(agentEvalRunTopics)
      .leftJoin(agentEvalTestCases, eq(agentEvalRunTopics.testCaseId, agentEvalTestCases.id))
      .leftJoin(topics, eq(agentEvalRunTopics.topicId, topics.id))
      .where(
        and(
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.testCaseId, testCaseId),
          this.ownership(),
        ),
      )
      .limit(1);

    return row;
  };

  deleteByRunAndTestCase = async (runId: string, testCaseId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.testCaseId, testCaseId),
        ),
      )
      .returning();
  };

  /**
   * Delete error/timeout RunTopics for a run, returning deleted rows
   */
  deleteErrorRunTopics = async (runId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          or(eq(agentEvalRunTopics.status, 'error'), eq(agentEvalRunTopics.status, 'timeout')),
        ),
      )
      .returning();
  };

  /**
   * Update a RunTopic by composite key (runId + topicId)
   */
  updateByRunAndTopic = async (
    runId: string,
    topicId: string,
    value: Pick<
      Partial<AgentEvalRunTopicItem>,
      'createdAt' | 'evalResult' | 'passed' | 'score' | 'status'
    >,
    options?: { allowAborted?: boolean; executionId?: string; status?: string },
  ) => {
    const [result] = await this.db
      .update(agentEvalRunTopics)
      .set(value)
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.topicId, topicId),
          options && 'executionId' in options
            ? sql`${agentEvalRunTopics.evalResult}->>'executionId' IS NOT DISTINCT FROM ${options.executionId ?? null}::text`
            : undefined,
          options?.status ? eq(agentEvalRunTopics.status, options.status as any) : undefined,
          options?.allowAborted
            ? undefined
            : sql`COALESCE(${agentEvalRunTopics.evalResult}->>'completionReason', '') <> 'aborted'`,
        ),
      )
      .returning();
    return result;
  };

  /** Merge operation identity without replacing a completion that raced ahead of startup. */
  mergeExecutionResult = async (
    runId: string,
    topicId: string,
    executionId: string,
    value: Record<string, unknown>,
  ) => {
    const [result] = await this.db
      .update(agentEvalRunTopics)
      .set({
        evalResult: sql`COALESCE(${agentEvalRunTopics.evalResult}, '{}'::jsonb) || ${JSON.stringify(value)}::jsonb`,
      })
      .where(
        and(
          this.ownership(),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.topicId, topicId),
          sql`${agentEvalRunTopics.evalResult}->>'executionId' = ${executionId}`,
          sql`COALESCE(${agentEvalRunTopics.evalResult}->>'completionReason', '') <> 'aborted'`,
          sql`${agentEvalRunTopics.status} IS DISTINCT FROM 'timeout'`,
        ),
      )
      .returning();
    return result;
  };
}
