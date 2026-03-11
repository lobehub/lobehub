import { and, asc, desc, eq, lt, or } from 'drizzle-orm';

import {
  agentEvalRuns,
  type AgentEvalRunTopicItem,
  agentEvalRunTopics,
  agentEvalTestCases,
  type NewAgentEvalRunTopic,
  topics,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';

export class AgentEvalRunTopicModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Batch create run-topic associations
   */
  batchCreate = async (items: Omit<NewAgentEvalRunTopic, 'userId'>[]) => {
    if (items.length === 0) return [];
    const withUserId = items.map((item) => ({ ...item, userId: this.userId }));
    return this.db.insert(agentEvalRunTopics).values(withUserId).returning();
  };

  /**
   * Find all topics for a run (with TestCase and Topic details)
   */
  findByRunId = async (runId: string) => {
    const rows = await this.db
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
      .where(and(eq(agentEvalRunTopics.runId, runId), eq(agentEvalRunTopics.userId, this.userId)))
      .orderBy(asc(agentEvalTestCases.sortOrder));

    return rows;
  };

  /**
   * Delete all run-topic associations for a run
   */
  deleteByRunId = async (runId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(and(eq(agentEvalRunTopics.runId, runId), eq(agentEvalRunTopics.userId, this.userId)));
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
      .where(
        and(
          eq(agentEvalRunTopics.testCaseId, testCaseId),
          eq(agentEvalRunTopics.userId, this.userId),
        ),
      )
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
          eq(agentEvalRunTopics.userId, this.userId),
        ),
      )
      .limit(1);

    return row;
  };

  /**
   * Batch mark timed-out RunTopics:
   * Per-row check: created_at + timeoutMs < NOW()
   * Returns the updated rows so callers can compute per-row duration.
   */
  batchMarkAborted = async (runId: string) => {
    return this.db
      .update(agentEvalRunTopics)
      .set({ status: 'error', evalResult: { error: 'Aborted' } })
      .where(
        and(
          eq(agentEvalRunTopics.userId, this.userId),
          eq(agentEvalRunTopics.runId, runId),
          or(eq(agentEvalRunTopics.status, 'pending'), eq(agentEvalRunTopics.status, 'running')),
        ),
      )
      .returning();
  };

  batchMarkTimeout = async (runId: string, timeoutMs: number) => {
    const deadline = new Date(Date.now() - timeoutMs);
    return this.db
      .update(agentEvalRunTopics)
      .set({ status: 'timeout' })
      .where(
        and(
          eq(agentEvalRunTopics.userId, this.userId),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.status, 'running'),
          lt(agentEvalRunTopics.createdAt, deadline),
        ),
      )
      .returning();
  };

  deleteByRunAndTestCase = async (runId: string, testCaseId: string) => {
    return this.db
      .delete(agentEvalRunTopics)
      .where(
        and(
          eq(agentEvalRunTopics.userId, this.userId),
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
          eq(agentEvalRunTopics.userId, this.userId),
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
    value: Pick<Partial<AgentEvalRunTopicItem>, 'evalResult' | 'passed' | 'score' | 'status'>,
  ) => {
    const [result] = await this.db
      .update(agentEvalRunTopics)
      .set(value)
      .where(
        and(
          eq(agentEvalRunTopics.userId, this.userId),
          eq(agentEvalRunTopics.runId, runId),
          eq(agentEvalRunTopics.topicId, topicId),
        ),
      )
      .returning();
    return result;
  };
}
