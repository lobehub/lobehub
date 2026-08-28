import { and, desc, eq, inArray } from 'drizzle-orm';

import type { NewVerifyCriterion, VerifyCriterionItem } from '../schemas/verify';
import { verifyCriteria, verifyRubricCriteria } from '../schemas/verify';
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

  /**
   * Give a task private copies of criteria that are still mounted on a reusable
   * rubric. Older task configs could point at the rubric rows directly; editing
   * those rows would silently rewrite the template for every future task.
   *
   * Returned ids preserve the input order. Criteria that are already task-local
   * keep their identity, while rubric-owned criteria are cloned in one transaction.
   */
  forkRubricCriteria = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    return this.db.transaction(async (tx) => {
      const criteria = await tx
        .select()
        .from(verifyCriteria)
        .where(and(inArray(verifyCriteria.id, ids), this.ownership()));
      const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));

      const rubricLinks = await tx
        .select({ criterionId: verifyRubricCriteria.criterionId })
        .from(verifyRubricCriteria)
        .where(
          and(
            inArray(verifyRubricCriteria.criterionId, ids),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              verifyRubricCriteria,
            ),
          ),
        );
      const sharedIds = new Set(rubricLinks.map(({ criterionId }) => criterionId));
      const sharedCriteria = ids
        .filter((id, index) => sharedIds.has(id) && ids.indexOf(id) === index)
        .map((id) => criteriaById.get(id))
        .filter((criterion): criterion is VerifyCriterionItem => Boolean(criterion));

      if (sharedCriteria.length === 0) return ids;

      const clones = await tx
        .insert(verifyCriteria)
        .values(
          sharedCriteria.map(
            ({ createdAt: _createdAt, id: _id, updatedAt: _updatedAt, ...criterion }) =>
              buildWorkspacePayload(
                { userId: this.userId, workspaceId: this.workspaceId },
                criterion,
              ),
          ),
        )
        .returning({ id: verifyCriteria.id });
      const forkedById = new Map(
        sharedCriteria.map((criterion, index) => [criterion.id, clones[index].id]),
      );

      return ids.map((id) => forkedById.get(id) ?? id);
    });
  };

  update = async (id: string, value: Partial<Omit<VerifyCriterionItem, 'id' | 'userId'>>) => {
    return this.db
      .update(verifyCriteria)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(verifyCriteria.id, id), this.ownership()));
  };
}
