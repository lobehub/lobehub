import { and, asc, desc, eq } from 'drizzle-orm';

import type { NewVerifyRubric, VerifyCriterionItem, VerifyRubricItem } from '../schemas/verify';
import { verifyCriteria, verifyRubricCriteria, verifyRubrics } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface RubricCriterionInput {
  criterionId: string;
  sortOrder?: number | null;
}

export class VerifyRubricModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private rubricOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyRubrics);

  private criteriaOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      verifyRubricCriteria,
    );

  create = async (params: Omit<NewVerifyRubric, 'userId' | 'workspaceId'>) => {
    const [result] = await this.db
      .insert(verifyRubrics)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result;
  };

  delete = async (id: string) => {
    // verify_rubric_criteria rows cascade via FK onDelete: 'cascade'.
    return this.db
      .delete(verifyRubrics)
      .where(and(eq(verifyRubrics.id, id), this.rubricOwnership()));
  };

  query = async () => {
    return this.db.query.verifyRubrics.findMany({
      orderBy: [desc(verifyRubrics.updatedAt)],
      where: this.rubricOwnership(),
    });
  };

  findById = async (id: string) => {
    return this.db.query.verifyRubrics.findFirst({
      where: and(eq(verifyRubrics.id, id), this.rubricOwnership()),
    });
  };

  update = async (id: string, value: Partial<Omit<VerifyRubricItem, 'id' | 'userId'>>) => {
    return this.db
      .update(verifyRubrics)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(verifyRubrics.id, id), this.rubricOwnership()));
  };

  /**
   * Resolve a rubric into its current criterion definitions, ordered by the
   * junction `sortOrder`. Used by the plan generator to instantiate the rubric
   * mounted on an agent. Scoped to the active workspace (or personal scope).
   */
  getCriteria = async (rubricId: string): Promise<VerifyCriterionItem[]> => {
    const rows = await this.db
      .select({ criterion: verifyCriteria })
      .from(verifyRubricCriteria)
      .innerJoin(verifyCriteria, eq(verifyRubricCriteria.criterionId, verifyCriteria.id))
      .where(and(eq(verifyRubricCriteria.rubricId, rubricId), this.criteriaOwnership()))
      .orderBy(asc(verifyRubricCriteria.sortOrder));

    return rows.map((r) => r.criterion);
  };

  /**
   * Replace the full set of criteria attached to a rubric. Idempotent: clears
   * existing junction rows then inserts the provided set with their sort order.
   */
  setCriteria = async (rubricId: string, criteria: RubricCriterionInput[]) => {
    await this.db
      .delete(verifyRubricCriteria)
      .where(and(eq(verifyRubricCriteria.rubricId, rubricId), this.criteriaOwnership()));

    if (criteria.length === 0) return;

    await this.db.insert(verifyRubricCriteria).values(
      criteria.map((c, index) =>
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            criterionId: c.criterionId,
            rubricId,
            sortOrder: c.sortOrder ?? index,
          },
        ),
      ),
    );
  };
}
