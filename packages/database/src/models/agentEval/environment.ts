import type { EvalCaseEnvironment } from '@lobechat/types';
import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';

import {
  agentEvalEnvironments,
  agentEvalTestCases,
  type NewAgentEvalEnvironment,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Reusable case environments. Owned like test cases: by the user, or by the
 * workspace when the model is scoped to one; system environments
 * (`userId IS NULL`, those of the built-in case sets) are readable by everyone
 * and changed by no one.
 */
export class AgentEvalEnvironmentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    or(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        agentEvalEnvironments,
      ),
      isNull(agentEvalEnvironments.userId),
    );

  /** Mutate-only predicate excluding system rows. */
  private mutableOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentEvalEnvironments,
    );

  create = async (params: Omit<NewAgentEvalEnvironment, 'userId' | 'workspaceId'>) => {
    const [result] = await this.db
      .insert(agentEvalEnvironments)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();
    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(agentEvalEnvironments)
      .where(and(eq(agentEvalEnvironments.id, id), this.mutableOwnership()));
  };

  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalEnvironments)
      .where(and(eq(agentEvalEnvironments.id, id), this.ownership()))
      .limit(1);
    return result;
  };

  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select()
      .from(agentEvalEnvironments)
      .where(and(eq(agentEvalEnvironments.identifier, identifier), this.ownership()))
      .limit(1);
    return result;
  };

  /** Several environments at once (for resolving a batch of cases); unknown ids are skipped. */
  findByIds = async (ids: string[]) => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return this.db
      .select()
      .from(agentEvalEnvironments)
      .where(and(inArray(agentEvalEnvironments.id, unique), this.ownership()));
  };

  /** Every environment of the owner, newest first, with the number of cases pointing at it. */
  query = async () => {
    const rows = await this.db
      .select({
        config: agentEvalEnvironments.config,
        createdAt: agentEvalEnvironments.createdAt,
        description: agentEvalEnvironments.description,
        id: agentEvalEnvironments.id,
        identifier: agentEvalEnvironments.identifier,
        metadata: agentEvalEnvironments.metadata,
        name: agentEvalEnvironments.name,
        testCaseCount: count(agentEvalTestCases.id).as('testCaseCount'),
        updatedAt: agentEvalEnvironments.updatedAt,
        userId: agentEvalEnvironments.userId,
        workspaceId: agentEvalEnvironments.workspaceId,
      })
      .from(agentEvalEnvironments)
      .leftJoin(agentEvalTestCases, eq(agentEvalTestCases.environmentId, agentEvalEnvironments.id))
      .where(this.ownership())
      .groupBy(agentEvalEnvironments.id)
      .orderBy(desc(agentEvalEnvironments.createdAt));
    return rows.map((row) => ({ ...row, testCaseCount: Number(row.testCaseCount) }));
  };

  update = async (
    id: string,
    value: Partial<{
      config: EvalCaseEnvironment;
      description: string | null;
      identifier: string | null;
      metadata: Record<string, unknown> | null;
      name: string;
    }>,
  ) => {
    const [result] = await this.db
      .update(agentEvalEnvironments)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(agentEvalEnvironments.id, id), this.mutableOwnership()))
      .returning();
    return result;
  };
}
