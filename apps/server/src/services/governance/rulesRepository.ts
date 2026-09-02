import type { LobeChatDatabase } from '@lobechat/database';
import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { commandGovernanceRules } from '@/database/schemas';

import type {
  CommandExecutionTarget,
  CommandGovernancePatternType,
  CommandGovernanceRuleItem,
  CommandGovernanceScope,
} from './types';

export interface CreateRuleParams {
  action?: string;
  createdBy?: string;
  enabled?: boolean;
  pattern: string;
  patternType: CommandGovernancePatternType;
  scope: CommandGovernanceScope;
  userId: string;
}

export interface UpdateRuleParams {
  action?: string;
  enabled?: boolean;
  pattern?: string;
  patternType?: CommandGovernancePatternType;
  scope?: CommandGovernanceScope;
}

/**
 * CRUD against `command_governance_rules`, consumed by the `/api/governance`
 * HTTP handlers (admin panel) and by `policyGate.checkCommand` (the enabled-
 * rules lookup). Kept as plain functions over an injected `db` — mirrors how
 * `apps/server` services query `@/database/schemas` directly rather than
 * always going through a model class.
 */

/** All rules owned by a user, newest first — used by the admin list view. */
export const listRulesForUser = (
  db: LobeChatDatabase,
  userId: string,
): Promise<CommandGovernanceRuleItem[]> =>
  db
    .select()
    .from(commandGovernanceRules)
    .where(eq(commandGovernanceRules.userId, userId))
    .orderBy(desc(commandGovernanceRules.createdAt));

export interface ListAllRulesResult {
  items: CommandGovernanceRuleItem[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Every rule across every user, newest first — the admin panel's overview
 * table, so an operator isn't forced to already know which user to look up
 * before seeing anything is configured at all.
 */
export const listAllRules = async (
  db: LobeChatDatabase,
  { page = 1, pageSize = DEFAULT_PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<ListAllRulesResult> => {
  const clampedPage = Math.max(1, page);
  const clampedPageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));

  const [items, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(commandGovernanceRules)
      .orderBy(desc(commandGovernanceRules.createdAt))
      .limit(clampedPageSize)
      .offset((clampedPage - 1) * clampedPageSize),
    db.select({ value: count() }).from(commandGovernanceRules),
  ]);

  return { items, page: clampedPage, pageSize: clampedPageSize, total };
};

/**
 * Enabled rules relevant to one execution target — `scope = 'all'` OR
 * `scope = executionTarget`. This is the hot lookup `checkCommand` runs on
 * every governed tool call, so it is scoped as tightly as possible.
 */
export const listEnabledRulesForTarget = (
  db: LobeChatDatabase,
  userId: string,
  executionTarget: CommandExecutionTarget,
): Promise<CommandGovernanceRuleItem[]> =>
  db
    .select()
    .from(commandGovernanceRules)
    .where(
      and(
        eq(commandGovernanceRules.userId, userId),
        eq(commandGovernanceRules.enabled, true),
        inArray(commandGovernanceRules.scope, ['all', executionTarget]),
      ),
    );

export const createRule = async (
  db: LobeChatDatabase,
  params: CreateRuleParams,
): Promise<CommandGovernanceRuleItem> => {
  const [row] = await db
    .insert(commandGovernanceRules)
    .values({
      action: params.action ?? 'deny',
      createdBy: params.createdBy,
      enabled: params.enabled ?? true,
      pattern: params.pattern,
      patternType: params.patternType,
      scope: params.scope,
      userId: params.userId,
    })
    .returning();

  return row;
};

export const updateRule = async (
  db: LobeChatDatabase,
  id: string,
  patch: UpdateRuleParams,
): Promise<CommandGovernanceRuleItem | undefined> => {
  const [row] = await db
    .update(commandGovernanceRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(commandGovernanceRules.id, id))
    .returning();

  return row;
};

export const deleteRule = async (db: LobeChatDatabase, id: string): Promise<boolean> => {
  const deleted = await db
    .delete(commandGovernanceRules)
    .where(eq(commandGovernanceRules.id, id))
    .returning({ id: commandGovernanceRules.id });

  return deleted.length > 0;
};
