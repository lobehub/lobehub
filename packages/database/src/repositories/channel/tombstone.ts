import { sql } from 'drizzle-orm';

import { channelMessages } from '../../schemas';

/**
 * A message not deleted. A deleted one stays as a tombstone (`metadata.deletedAt`) so Threads,
 * replies and jobs that point at it still resolve; readers of its content skip it.
 */
export const messageStands = () => sql`${channelMessages.metadata} ->> 'deletedAt' IS NULL`;
