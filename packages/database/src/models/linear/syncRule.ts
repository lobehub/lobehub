import type { LinearSyncResult, LinearSyncRuleView } from '@lobechat/types';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { LinearSyncRuleItem, NewLinearSyncRule } from '../../schemas';
import { linearSyncRules } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { LinearConnectionScope } from './connection';

/**
 * Saved Linear → task sync filters, each owned by a LobeHub project. Like
 * `LinearConnectionModel` it exposes static methods; every read is narrowed
 * to a scope (the workspace's rules, or the user's personal ones).
 */
export class LinearSyncRuleModel {
  static listByProject = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    projectId: string,
  ): Promise<LinearSyncRuleItem[]> =>
    db
      .select()
      .from(linearSyncRules)
      .where(and(eq(linearSyncRules.projectId, projectId), scopeCondition(scope)))
      .orderBy(desc(linearSyncRules.createdAt));

  static findInScope = async (
    db: LobeChatDatabase,
    id: string,
    scope: LinearConnectionScope,
  ): Promise<LinearSyncRuleItem | null> => {
    const [row] = await db
      .select()
      .from(linearSyncRules)
      .where(and(eq(linearSyncRules.id, id), scopeCondition(scope)));
    return row ?? null;
  };

  /**
   * Lock the rule row until the transaction ends, so concurrent starts of the
   * same rule check for a running job one at a time. False when it is gone.
   */
  static lockInScope = async (
    db: LobeChatDatabase,
    id: string,
    scope: LinearConnectionScope,
  ): Promise<boolean> => {
    const rows = await db
      .select({ id: linearSyncRules.id })
      .from(linearSyncRules)
      .where(and(eq(linearSyncRules.id, id), scopeCondition(scope)))
      .for('update');
    return rows.length > 0;
  };

  static create = async (
    db: LobeChatDatabase,
    values: NewLinearSyncRule,
  ): Promise<LinearSyncRuleItem> => {
    const [row] = await db.insert(linearSyncRules).values(values).returning();
    return row;
  };

  static delete = async (
    db: LobeChatDatabase,
    id: string,
    scope: LinearConnectionScope,
  ): Promise<void> => {
    await db.delete(linearSyncRules).where(and(eq(linearSyncRules.id, id), scopeCondition(scope)));
  };

  static recordRun = async (
    db: LobeChatDatabase,
    id: string,
    scope: LinearConnectionScope,
    result: LinearSyncResult,
  ): Promise<void> => {
    await db
      .update(linearSyncRules)
      .set({ lastResult: result, lastRunAt: new Date(), updatedAt: new Date() })
      .where(and(eq(linearSyncRules.id, id), scopeCondition(scope)));
  };

  static toView = (row: LinearSyncRuleItem): LinearSyncRuleView => ({
    connectionId: row.connectionId,
    createdAt: row.createdAt,
    id: row.id,
    lastResult: row.lastResult ?? null,
    lastRunAt: row.lastRunAt,
    linearProjectId: row.linearProjectId,
    linearProjectName: row.linearProjectName,
    projectId: row.projectId,
    stateTypes: row.stateTypes,
    teamId: row.teamId,
    teamName: row.teamName,
  });
}

const scopeCondition = (scope: LinearConnectionScope) =>
  scope.workspaceId
    ? eq(linearSyncRules.workspaceId, scope.workspaceId)
    : and(eq(linearSyncRules.userId, scope.userId), isNull(linearSyncRules.workspaceId));
