import { sql } from 'drizzle-orm';

import { channelMessages } from '../../schemas';

/**
 * A message not deleted. A deleted one stays as a tombstone (`metadata.deletedAt`) so Threads,
 * replies and jobs that point at it still resolve; readers of its content skip it.
 *
 * The predicate is a qual on several read paths, so it must not null-test an extracted jsonb
 * value directly: `(metadata ->> 'deletedAt') IS NULL` takes the planner down on any table that
 * carries a bm25 index (see `models/__tests__/jsonbNullTest.test.ts`). COALESCE to a sentinel
 * keeps the same meaning for a missing key or a JSON null, and costs nothing.
 */
export const messageStands = () =>
  sql`COALESCE(${channelMessages.metadata} ->> 'deletedAt', '') = ''`;
