import { and, eq } from 'drizzle-orm';

import { type Database, groups, memberships } from './schema';

export class GroupModel {
  constructor(
    private db: Database,
    private userId: string,
  ) {}

  async removeMembers(groupId: string) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, groupId), eq(groups.userId, this.userId)),
    });
    if (!group) throw new Error('Forbidden');
    return this.db.delete(memberships).where(eq(memberships.groupId, group.id));
  }
}
