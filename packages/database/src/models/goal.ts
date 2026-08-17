import type { GoalStatus, GoalSubjectType } from '@lobechat/const/goal';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { GoalItem, NewGoal } from '../schemas/goal';
import { goals } from '../schemas/goal';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** States after which a goal's loop no longer advances. */
const TERMINAL_GOAL_STATUSES = new Set<GoalStatus>(['achieved', 'failed', 'canceled']);

/**
 * Owns the `goals` table: one row per goal — an independent target entity with
 * its own definition (title / requirement), budget and lifecycle state. The
 * execution carrier is a polymorphic (`subjectType`, `subjectId`) link (task /
 * topic / standalone); everything execution-specific (rounds run, cost spent,
 * acceptance checks) stays on the carrier and its tables and is derived at
 * read time, never denormalized here.
 */
export class GoalModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, goals);

  create = async (params: Omit<NewGoal, 'userId' | 'workspaceId'>): Promise<GoalItem> => {
    const [row] = await this.db
      .insert(goals)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();
    return row;
  };

  findById = async (id: string): Promise<GoalItem | undefined> => {
    return this.db.query.goals.findFirst({ where: and(eq(goals.id, id), this.ownership()) });
  };

  /** The goal bound to a carrier, or undefined when the subject carries none. */
  findBySubject = async (
    subjectType: GoalSubjectType,
    subjectId: string,
  ): Promise<GoalItem | undefined> => {
    return this.db.query.goals.findFirst({
      where: and(
        eq(goals.subjectType, subjectType),
        eq(goals.subjectId, subjectId),
        this.ownership(),
      ),
    });
  };

  /**
   * The goals of many carriers in one read — for list surfaces (goal rail /
   * goals page) that already queried the carriers and need each row's goal
   * without a request per row.
   */
  listBySubjects = async (subjectType: GoalSubjectType, subjectIds: string[]) => {
    if (subjectIds.length === 0) return [];

    return this.db
      .select()
      .from(goals)
      .where(
        and(
          eq(goals.subjectType, subjectType),
          inArray(goals.subjectId, subjectIds),
          this.ownership(),
        ),
      );
  };

  /** Recent goals for the current scope, newest first. */
  query = async (limit = 50) => {
    return this.db.query.goals.findMany({
      limit,
      orderBy: [desc(goals.createdAt)],
      where: this.ownership(),
    });
  };

  update = async (id: string, value: Partial<Omit<GoalItem, 'id' | 'userId'>>) => {
    const [row] = await this.db
      .update(goals)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(goals.id, id), this.ownership()))
      .returning();
    return row as GoalItem | undefined;
  };

  /**
   * Advance the lifecycle state, stamping the boundary timestamps as a side
   * effect: first entry into `running` records `startedAt`, any terminal state
   * records `completedAt` (and re-opening a terminal goal clears it).
   */
  updateStatus = async (id: string, status: GoalStatus) => {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return this.update(id, {
      completedAt: TERMINAL_GOAL_STATUSES.has(status) ? (existing.completedAt ?? new Date()) : null,
      startedAt: existing.startedAt ?? (status === 'running' ? new Date() : null),
      status,
    });
  };

  delete = async (id: string) => {
    return this.db.delete(goals).where(and(eq(goals.id, id), this.ownership()));
  };

  deleteBySubject = async (subjectType: GoalSubjectType, subjectId: string) => {
    return this.db
      .delete(goals)
      .where(
        and(eq(goals.subjectType, subjectType), eq(goals.subjectId, subjectId), this.ownership()),
      );
  };
}
