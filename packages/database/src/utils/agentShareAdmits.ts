import type { SQL } from 'drizzle-orm';
import { and, eq, exists, or, sql } from 'drizzle-orm';

import { agentShareGrants, agentShares } from '../schemas';

/**
 * Whether the joined `agent_shares` row admits a visitor: a `link` share admits anyone signed in,
 * a `card` share only the people its owner granted it to by card and has not revoked. Without a visitor only a `link`
 * share does, so a caller that cannot name one fails closed on a `card` share.
 */
export const agentShareAdmits = (visitorUserId: string | undefined): SQL =>
  visitorUserId
    ? or(
        eq(agentShares.visibility, 'link'),
        and(
          eq(agentShares.visibility, 'card'),
          exists(
            sql`(SELECT 1 FROM ${agentShareGrants} WHERE ${agentShareGrants.shareId} = ${agentShares.id} AND ${agentShareGrants.userId} = ${visitorUserId} AND ${agentShareGrants.revokedAt} IS NULL)`,
          ),
        ),
      )!
    : eq(agentShares.visibility, 'link');
