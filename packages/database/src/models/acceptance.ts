import type { AcceptanceStatus, AcceptanceSubjectType } from '@lobechat/types';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { AcceptanceItem, NewAcceptance } from '../schemas/verify';
import { acceptances } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { isUuid } from '../utils/uuid';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** Statuses a user's decision produced — sticky until explicitly re-opened. */
const TERMINAL_ACCEPTANCE_STATUSES = new Set<AcceptanceStatus>(['accepted', 'closed', 'rejected']);

/**
 * Owns the business-level acceptance aggregate (`acceptances`): one row per
 * subject (task / topic / document / standalone delivery) carrying the
 * user-facing lifecycle state.
 * The verify rounds chain onto it through `verify_runs.acceptance_id` +
 * `round_index`; this model deliberately holds no round pointers — root /
 * current / latest-report are all derived from that chain at read time.
 */
export class AcceptanceModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, acceptances);

  /**
   * Scope-dependent visibility default: personal aggregates are link-shareable
   * (`public`), workspace aggregates stay member-gated (`private`). An explicit
   * caller value always wins.
   */
  private defaultVisibility = () => (this.workspaceId ? ('private' as const) : ('public' as const));

  create = async (
    params: Omit<NewAcceptance, 'userId' | 'workspaceId'>,
  ): Promise<AcceptanceItem> => {
    const [row] = await this.db
      .insert(acceptances)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { visibility: this.defaultVisibility(), ...params },
        ),
      )
      .returning();
    return row;
  };

  findById = async (id: string) => {
    // A malformed id (e.g. an autolinker glued trailing punctuation onto a
    // shared link) would abort the query with 22P02 — read it as "not found".
    if (!isUuid(id)) return undefined;
    return this.db.query.acceptances.findFirst({
      where: and(eq(acceptances.id, id), this.ownership()),
    });
  };

  /** The (unique per scope) acceptance for a subject, or undefined when none yet. */
  findBySubject = async (subjectType: AcceptanceSubjectType, subjectId: string) => {
    return this.db.query.acceptances.findFirst({
      where: and(
        eq(acceptances.subjectType, subjectType),
        eq(acceptances.subjectId, subjectId),
        this.ownership(),
      ),
    });
  };

  /**
   * The status of many subjects' acceptances in one read — for list surfaces
   * that must know each row's state without a request per row. Exact where the
   * recency-capped `query()` is not: it answers about the subjects asked for,
   * however old they are, and one acceptance per subject is a scope invariant.
   */
  listStatusesBySubjects = async (
    subjectType: AcceptanceSubjectType,
    subjectIds: string[],
  ): Promise<Array<{ status: string; subjectId: string }>> => {
    if (subjectIds.length === 0) return [];

    return this.db
      .select({ status: acceptances.status, subjectId: acceptances.subjectId })
      .from(acceptances)
      .where(
        and(
          eq(acceptances.subjectType, subjectType),
          inArray(acceptances.subjectId, subjectIds),
          this.ownership(),
        ),
      );
  };

  /**
   * Get (or lazily create) the acceptance aggregate for a subject. Upserts on
   * the per-scope subject unique index so concurrent callers converge on one
   * row; `defaults` only apply on first creation and never overwrite an
   * existing aggregate.
   */
  ensureForSubject = async (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
    defaults?: Partial<Pick<NewAcceptance, 'config' | 'metadata' | 'projectId' | 'requirement'>>,
  ): Promise<AcceptanceItem> => {
    const existing = await this.findBySubject(subjectType, subjectId);
    if (existing) {
      // A recorded requirement is never overwritten — but an aggregate created
      // WITHOUT one (a first ingest that omitted it) accepts the first
      // non-empty statement a later round supplies, instead of staying blank
      // forever ("尚未记录该对象的验收目标").
      const nextRequirement = !existing.requirement ? defaults?.requirement : undefined;
      const nextProjectId = !existing.projectId ? defaults?.projectId : undefined;
      const nextTitle =
        !existing.metadata?.title && typeof defaults?.metadata?.title === 'string'
          ? defaults.metadata.title
          : undefined;
      if (nextProjectId || nextRequirement || nextTitle) {
        const metadata = nextTitle ? { ...existing.metadata, title: nextTitle } : existing.metadata;
        await this.db
          .update(acceptances)
          .set({
            metadata,
            projectId: nextProjectId ?? existing.projectId,
            requirement: nextRequirement ?? existing.requirement,
          })
          .where(eq(acceptances.id, existing.id));
        return {
          ...existing,
          metadata,
          projectId: nextProjectId ?? existing.projectId,
          requirement: nextRequirement ?? existing.requirement,
        };
      }
      return existing;
    }

    await this.db
      .insert(acceptances)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { subjectId, subjectType, visibility: this.defaultVisibility(), ...defaults },
        ),
      )
      // Conflict = another caller won the per-scope subject unique index race.
      .onConflictDoNothing();

    // Re-read so concurrent winners and this caller both return the canonical row.
    return (await this.findBySubject(subjectType, subjectId))!;
  };

  /** Recent acceptances for the current user/workspace, newest first. */
  query = async (limit = 50) => {
    return this.db.query.acceptances.findMany({
      limit,
      orderBy: [desc(acceptances.createdAt)],
      where: this.ownership(),
    });
  };

  update = async (
    id: string,
    value: Partial<
      Pick<
        NewAcceptance,
        'config' | 'metadata' | 'projectId' | 'requirement' | 'visibility' | 'visualRender'
      >
    >,
  ): Promise<AcceptanceItem | undefined> => {
    const [row] = await this.db
      .update(acceptances)
      .set(value)
      .where(and(eq(acceptances.id, id), this.ownership()))
      .returning();
    return row;
  };

  /**
   * Move the user-facing lifecycle state. `completedAt` is stamped when the
   * user's decision closes the loop (accepted / closed / rejected) and cleared when a
   * new round re-opens it.
   */
  updateStatus = async (id: string, status: AcceptanceStatus): Promise<void> => {
    await this.db
      .update(acceptances)
      .set({
        completedAt: TERMINAL_ACCEPTANCE_STATUSES.has(status) ? new Date() : null,
        status,
      })
      .where(and(eq(acceptances.id, id), this.ownership()));
  };

  delete = async (id: string) => {
    return this.db.delete(acceptances).where(and(eq(acceptances.id, id), this.ownership()));
  };
}
