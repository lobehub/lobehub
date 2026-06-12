import { and, desc, eq, inArray } from 'drizzle-orm';

import type { NewVerifyCriterion, VerifyCriterionItem } from '../schemas/verify';
import { verifyCriteria } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class VerifyCriterionModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyCriteria);

  create = async (params: Omit<NewVerifyCriterion, 'userId' | 'workspaceId'>) => {
    const [result] = await this.db
      .insert(verifyCriteria)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(verifyCriteria).where(and(eq(verifyCriteria.id, id), this.ownership()));
  };

  query = async () => {
    return this.db.query.verifyCriteria.findMany({
      orderBy: [desc(verifyCriteria.updatedAt)],
      where: this.ownership(),
    });
  };

  findById = async (id: string) => {
    return this.db.query.verifyCriteria.findFirst({
      where: and(eq(verifyCriteria.id, id), this.ownership()),
    });
  };

  /**
   * Resolve a set of criterion ids into their current definitions. Used by the
   * plan generator to instantiate ad-hoc `verifyCriteriaIds` mounted on an agent.
   * Scoped to the active workspace (or personal scope) so a leaked id can't pull
   * another tenant's criterion.
   */
  findByIds = async (ids: string[]): Promise<VerifyCriterionItem[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(verifyCriteria)
      .where(and(inArray(verifyCriteria.id, ids), this.ownership()));
  };

  update = async (id: string, value: Partial<Omit<VerifyCriterionItem, 'id' | 'userId'>>) => {
    return this.db
      .update(verifyCriteria)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(verifyCriteria.id, id), this.ownership()));
  };
}
