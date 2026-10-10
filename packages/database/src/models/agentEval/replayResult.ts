import type { EvalReplayTarget } from '@lobechat/types';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';

import {
  agentEvalReplayResults,
  agentEvalRuns,
  type NewAgentEvalReplayResult,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

type ReplayResultUpdate = Partial<
  Omit<NewAgentEvalReplayResult, 'id' | 'runId' | 'testCaseId' | 'userId' | 'workspaceId'>
>;

/**
 * Cells of a cross-model comparison run: one row per (test case × target).
 * Rows are seeded `pending` when the run starts and filled in by the replay
 * worker, so the grid is complete — including not-yet-run cells — from the
 * first read.
 */
export class AgentEvalReplayResultModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentEvalReplayResults,
    );

  /**
   * Seed one pending cell per (test case × target). Re-seeding an existing
   * cell is a no-op, so a restarted run keeps the cells it already finished.
   */
  seedPending = async (runId: string, testCaseIds: string[], targets: EvalReplayTarget[]) => {
    if (testCaseIds.length === 0 || targets.length === 0) return [];

    const rows: NewAgentEvalReplayResult[] = testCaseIds.flatMap((testCaseId) =>
      targets.map((target) => ({
        model: target.model,
        provider: target.provider,
        runId,
        status: 'pending' as const,
        testCaseId,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })),
    );

    return this.db
      .insert(agentEvalReplayResults)
      .values(rows)
      .onConflictDoNothing({
        target: [
          agentEvalReplayResults.runId,
          agentEvalReplayResults.testCaseId,
          agentEvalReplayResults.provider,
          agentEvalReplayResults.model,
        ],
      })
      .returning();
  };

  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalReplayResults)
      .where(and(eq(agentEvalReplayResults.id, id), this.ownership()))
      .limit(1);
    return result;
  };

  findByRunId = async (runId: string) =>
    this.db
      .select()
      .from(agentEvalReplayResults)
      .where(and(eq(agentEvalReplayResults.runId, runId), this.ownership()))
      .orderBy(
        asc(agentEvalReplayResults.testCaseId),
        asc(agentEvalReplayResults.provider),
        asc(agentEvalReplayResults.model),
      );

  /** Every cell any run produced for one test case, newest run first. */
  findByTestCaseId = async (testCaseId: string) =>
    this.db
      .select({ cell: agentEvalReplayResults, run: agentEvalRuns })
      .from(agentEvalReplayResults)
      .innerJoin(agentEvalRuns, eq(agentEvalRuns.id, agentEvalReplayResults.runId))
      .where(and(eq(agentEvalReplayResults.testCaseId, testCaseId), this.ownership()))
      .orderBy(desc(agentEvalRuns.createdAt), asc(agentEvalReplayResults.model));

  /**
   * Move a pending cell to running. Returns undefined when the cell was not
   * pending — another delivery already took it — so duplicate workflow
   * deliveries never call the model twice.
   */
  claim = async (id: string) => {
    const [result] = await this.db
      .update(agentEvalReplayResults)
      .set({ status: 'running', updatedAt: new Date() })
      .where(
        and(
          eq(agentEvalReplayResults.id, id),
          eq(agentEvalReplayResults.status, 'pending'),
          this.ownership(),
        ),
      )
      .returning();
    return result;
  };

  update = async (id: string, value: ReplayResultUpdate) => {
    const [result] = await this.db
      .update(agentEvalReplayResults)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(agentEvalReplayResults.id, id), this.ownership()))
      .returning();
    return result;
  };

  /** Cells of a run still waiting on, or in the middle of, a replay. */
  countUnfinished = async (runId: string) => {
    const [result] = await this.db
      .select({ value: count() })
      .from(agentEvalReplayResults)
      .where(
        and(
          eq(agentEvalReplayResults.runId, runId),
          inArray(agentEvalReplayResults.status, ['pending', 'running']),
          this.ownership(),
        ),
      );
    return Number(result?.value) || 0;
  };

  /** Reset every errored cell of a run to pending so it can be re-dispatched. */
  resetErrored = async (runId: string) =>
    this.db
      .update(agentEvalReplayResults)
      .set({
        content: null,
        durationMs: null,
        error: null,
        judgeReason: null,
        passed: null,
        score: null,
        status: 'pending',
        toolCalls: null,
        updatedAt: new Date(),
        usage: null,
      })
      .where(
        and(
          eq(agentEvalReplayResults.runId, runId),
          eq(agentEvalReplayResults.status, 'error'),
          this.ownership(),
        ),
      )
      .returning();
}
