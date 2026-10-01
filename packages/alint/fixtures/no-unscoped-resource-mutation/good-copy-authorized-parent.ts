import { and, eq } from 'drizzle-orm';

import { type Database, groups, memberships } from './schema';

export class GroupModel {
  constructor(
    private db: Database,
    private userId: string,
  ) {}

  async duplicate(groupId: string) {
    const source = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, groupId), eq(groups.userId, this.userId)),
    });
    if (!source) return;
    const members = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.groupId, source.id));
    const [copy] = await this.db.insert(groups).values({ userId: this.userId }).returning();
    return this.db.insert(memberships).values(
      members.map((member) => ({
        agentId: member.agentId,
        groupId: copy.id,
        userId: this.userId,
      })),
    );
  }
}
