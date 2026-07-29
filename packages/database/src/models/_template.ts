// When you copy this template for a new model, also copy the matching test
// template `./__tests__/_test_template.ts` into `./__tests__/<name>.test.ts`.
// Every model ships with a sibling test — see the `testing` skill
// (.agents/skills/testing/references/db-model-test.md).
import { and, desc, eq } from 'drizzle-orm';

import type { NewSessionGroup, SessionGroupItem } from '../schemas';
import { sessionGroups } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class TemplateModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewSessionGroup, 'userId'>) => {
    const [result] = await this.db
      .insert(sessionGroups)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(sessionGroups)
      .where(and(eq(sessionGroups.id, id), eq(sessionGroups.userId, this.userId)));
  };

  deleteAll = async () => {
    return this.db.delete(sessionGroups).where(eq(sessionGroups.userId, this.userId));
  };

  query = async () => {
    return this.db.query.sessionGroups.findMany({
      orderBy: [desc(sessionGroups.updatedAt)],
      where: eq(sessionGroups.userId, this.userId),
    });
  };

  findById = async (id: string) => {
    return this.db.query.sessionGroups.findFirst({
      where: and(eq(sessionGroups.id, id), eq(sessionGroups.userId, this.userId)),
    });
  };

  update = async (id: string, value: Partial<SessionGroupItem>) => {
    return this.db
      .update(sessionGroups)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(sessionGroups.id, id), eq(sessionGroups.userId, this.userId)));
  };
}
