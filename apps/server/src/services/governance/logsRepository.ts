import type { LobeChatDatabase } from '@lobechat/database';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';

import { commandExecutionLogs } from '@/database/schemas';

import type {
  CommandExecutionLogItem,
  CommandExecutionTarget,
  CommandGovernanceContext,
  CommandGovernanceOutcome,
} from './types';

export interface InsertLogParams extends CommandGovernanceContext {
  outcome: CommandGovernanceOutcome;
}

export const insertLog = async (db: LobeChatDatabase, params: InsertLogParams): Promise<void> => {
  await db.insert(commandExecutionLogs).values({
    apiName: params.apiName,
    blocked: params.outcome.blocked,
    commandText: params.commandText,
    deviceId: params.deviceId,
    durationMs: params.outcome.durationMs,
    errorMessage: params.outcome.errorMessage,
    executionTarget: params.executionTarget,
    matchedRuleId: params.outcome.matchedRuleId,
    path: params.path,
    policyField: params.outcome.matchedField,
    success: params.outcome.success,
    toolIdentifier: params.toolIdentifier,
    userId: params.userId,
  });
};

export interface LogQueryFilter {
  blocked?: boolean;
  executionTarget?: CommandExecutionTarget;
  from?: Date;
  page?: number;
  pageSize?: number;
  to?: Date;
  userId?: string;
}

export interface LogQueryResult {
  items: CommandExecutionLogItem[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Paginated, filterable query over `command_execution_logs` for the admin panel. */
export const queryLogs = async (
  db: LobeChatDatabase,
  filter: LogQueryFilter,
): Promise<LogQueryResult> => {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE));

  const conditions = [
    filter.userId ? eq(commandExecutionLogs.userId, filter.userId) : undefined,
    filter.executionTarget
      ? eq(commandExecutionLogs.executionTarget, filter.executionTarget)
      : undefined,
    filter.blocked === undefined ? undefined : eq(commandExecutionLogs.blocked, filter.blocked),
    filter.from ? gte(commandExecutionLogs.createdAt, filter.from) : undefined,
    filter.to ? lte(commandExecutionLogs.createdAt, filter.to) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(commandExecutionLogs)
      .where(where)
      .orderBy(desc(commandExecutionLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(commandExecutionLogs).where(where),
  ]);

  return { items, page, pageSize, total };
};
