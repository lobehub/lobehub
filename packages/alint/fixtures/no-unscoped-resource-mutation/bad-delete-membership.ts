import { and, eq, inArray } from 'drizzle-orm';

import { type Database, memberships } from './schema';

export class GroupModel {
  constructor(
    private db: Database,
    private userId: string,
  ) {}

  remove(groupId: string, agentIds: string[]) {
    return (
      this.db
        .delete(memberships)
        // alint-expect
        .where(and(eq(memberships.groupId, groupId), inArray(memberships.agentId, agentIds)))
    );
  }
}
