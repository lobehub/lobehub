import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { notTrashed } from '../../utils/softDelete';

/** User memories have no workspace column, so they cannot use buildWorkspaceWhere. */
export const buildUserMemoryWhere = (
  userId: string,
  table: { isDeleted?: AnyPgColumn; userId: AnyPgColumn },
): SQL =>
  and(eq(table.userId, userId), table.isDeleted ? notTrashed(table.isDeleted) : undefined) as SQL;
