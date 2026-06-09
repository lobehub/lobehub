import { and, desc, eq, inArray } from 'drizzle-orm';

import type { NewVerifyCriterion, VerifyCriterionItem } from '../schemas/verify';
import { verifyCriteria } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';

export class VerifyCriterionModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: Omit<NewVerifyCriterion, 'userId'>) => {
    const [result] = await this.db
      .insert(verifyCriteria)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(verifyCriteria)
      .where(and(eq(verifyCriteria.id, id), eq(verifyCriteria.userId, this.userId)));
  };

  query = async () => {
    return this.db.query.verifyCriteria.findMany({
      orderBy: [desc(verifyCriteria.updatedAt)],
      where: eq(verifyCriteria.userId, this.userId),
    });
  };

  findById = async (id: string) => {
    return this.db.query.verifyCriteria.findFirst({
      where: and(eq(verifyCriteria.id, id), eq(verifyCriteria.userId, this.userId)),
    });
  };

  /**
   * Resolve a set of criterion ids into their current definitions. Used by the
   * plan generator to instantiate ad-hoc `verifyCriteriaIds` mounted on an agent.
   * Always scoped by `userId` so a leaked id can't pull another user's criterion.
   */
  findByIds = async (ids: string[]): Promise<VerifyCriterionItem[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(verifyCriteria)
      .where(and(inArray(verifyCriteria.id, ids), eq(verifyCriteria.userId, this.userId)));
  };

  update = async (id: string, value: Partial<Omit<VerifyCriterionItem, 'id' | 'userId'>>) => {
    return this.db
      .update(verifyCriteria)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(verifyCriteria.id, id), eq(verifyCriteria.userId, this.userId)));
  };
}
