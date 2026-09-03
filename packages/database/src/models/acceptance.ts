import type { AcceptanceStatus, AcceptanceSubjectType } from '@lobechat/types';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { AcceptanceItem, NewAcceptance } from '../schemas/verify';
import { acceptances } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { isUuid } from '../utils/uuid';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** Statuses a user's decision produced — sticky until explicitly re-opened. */
const TERMINAL_ACCEPTANCE_STATUSES = new Set<AcceptanceStatus>(['accepted', 'closed', 'rejected']);

/**
 * Opaque list cursor = `${createdAt ISO}__${id}`. Both parts are metacharacter-
 * free (ISO timestamp + uuid), so a plain `__` delimiter round-trips safely.
 * Mirrors `VerifyRunModel.queryPage`, whose page the reports panel reads.
 */
const encodeCursor = (createdAt: Date, id: string): string => `${createdAt.toISOString()}__${id}`;

const decodeCursor = (cursor?: string): { createdAt: Date; id: string } | null => {
  if (!cursor) return null;
  const idx = cursor.lastIndexOf('__');
  if (idx <= 0) return null;
  const createdAt = new Date(cursor.slice(0, idx));
  const id = cursor.slice(idx + 2);
  // The id half is compared against a uuid column, so a malformed one would be
  // parsed by Postgres and raise 22P02 — a client's bad cursor turning into a
  // 500. An unreadable cursor is simply the start of the feed.
  if (Number.isNaN(createdAt.getTime()) || !isUuid(id)) return null;
  return { createdAt, id };
};

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
   * Resolve an execution policy for a subject. Unlike report-facing reads,
   * workspace policy lookup is shared by every workspace member: a private
   * Acceptance controls the shared Task even when another member executes it.
   * Personal scope remains owner-isolated.
   */
  findPolicyBySubject = async (subjectType: AcceptanceSubjectType, subjectId: string) => {
    const policyScope = buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: acceptances.userId, workspaceId: acceptances.workspaceId },
    );

    return this.db.query.acceptances.findFirst({
      where: and(
        eq(acceptances.subjectType, subjectType),
        eq(acceptances.subjectId, subjectId),
        policyScope,
      ),
    });
  };

  /** Internal execution-policy lookup by id, independent of report visibility. */
  findPolicyById = async (id: string) => {
    if (!isUuid(id)) return undefined;
    const policyScope = buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: acceptances.userId, workspaceId: acceptances.workspaceId },
    );
    return this.db.query.acceptances.findFirst({
      where: and(eq(acceptances.id, id), policyScope),
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

  /** Acceptances for the current user/workspace, newest first. */
  query = async (
    options: { limit?: number; statuses?: AcceptanceStatus[]; unbounded?: boolean } = {},
  ) => {
    const { statuses, unbounded } = options;
    const limit = unbounded ? undefined : (options.limit ?? 50);
    return this.db.query.acceptances.findMany({
      limit,
      orderBy: [desc(acceptances.createdAt)],
      where:
        statuses && statuses.length > 0
          ? and(this.ownership(), inArray(acceptances.status, statuses))
          : this.ownership(),
    });
  };

  /**
   * Keyset page of the same feed, newest first — what the list panel scrolls.
   *
   * Takes the same `statuses` split as {@link query} so both entry points speak
   * one vocabulary: a page of "in progress" is thirty in-progress rows, not
   * thirty rows of which some happen to be in progress.
   */
  queryPage = async ({
    cursor,
    limit = 30,
    statuses,
  }: { cursor?: string; limit?: number; statuses?: AcceptanceStatus[] } = {}): Promise<{
    items: AcceptanceItem[];
    nextCursor: string | null;
  }> => {
    const conditions = [this.ownership()];
    if (statuses && statuses.length > 0) conditions.push(inArray(acceptances.status, statuses));

    // Millisecond-truncated createdAt — the precision the cursor round-trips
    // at. Comparing the raw timestamptz (microseconds) against a cursor read
    // back as a JS Date would let a row satisfy its own bound and repeat.
    const createdAtMs = sql`date_trunc('milliseconds', ${acceptances.createdAt})`;

    const decoded = decodeCursor(cursor);
    if (decoded) {
      // (createdAt, id) < (cursor.createdAt, cursor.id) in descending order.
      conditions.push(
        or(
          lt(createdAtMs, decoded.createdAt),
          and(eq(createdAtMs, decoded.createdAt), lt(acceptances.id, decoded.id)),
        )!,
      );
    }

    const rows = await this.db.query.acceptances.findMany({
      limit: limit + 1,
      orderBy: [desc(createdAtMs), desc(acceptances.id)],
      where: and(...conditions),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
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

  /** Internal policy write counterpart to `findPolicyBySubject`. */
  updatePolicy = async (
    id: string,
    value: Partial<Pick<NewAcceptance, 'config' | 'requirement'>>,
  ): Promise<AcceptanceItem | undefined> => {
    const policyScope = buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: acceptances.userId, workspaceId: acceptances.workspaceId },
    );
    const [row] = await this.db
      .update(acceptances)
      .set(value)
      .where(and(eq(acceptances.id, id), policyScope))
      .returning();
    return row;
  };

  /** Internal lifecycle transition counterpart to `updateStatus`. */
  updatePolicyStatus = async (id: string, status: AcceptanceStatus): Promise<void> => {
    const policyScope = buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: acceptances.userId, workspaceId: acceptances.workspaceId },
    );
    await this.db
      .update(acceptances)
      .set({
        completedAt: TERMINAL_ACCEPTANCE_STATUSES.has(status) ? new Date() : null,
        status,
      })
      .where(and(eq(acceptances.id, id), policyScope));
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
