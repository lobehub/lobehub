import { sql, type SQLWrapper } from 'drizzle-orm';

import { workspaceMembers } from '../schemas/workspace';

/**
 * The member's workspace nickname (`workspace_members.config.nickname`), or
 * `null` when unset or blank. Pass an aliased table's `config` column when the
 * query reads `workspace_members` under another name.
 */
export const memberNicknameSql = (config: SQLWrapper = workspaceMembers.config) =>
  sql<string | null>`nullif(trim(${config} ->> 'nickname'), '')`;
