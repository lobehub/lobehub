import type { SQL } from 'drizzle-orm';
import { and, asc, desc, gt, gte, isNull, lt, or, sql } from 'drizzle-orm';

import { messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { MessageGroupNodeWindow, MessageRoundCursor } from './types';

export interface RowBound {
  createdAt: string;
  id: string;
}

interface WindowRow {
  createdAtIso: string;
  id: string;
  role: string;
  steer: boolean;
}

/**
 * Microsecond-precision UTC string. `createdAt` is a timestamptz whose now()
 * default can carry microseconds, but a JS Date keeps only milliseconds — a
 * Date-derived cursor would round sub-millisecond boundaries and let rows leak
 * between adjacent pages. Carry the lossless value in the cursor and compare it
 * back with a ::timestamptz cast.
 */
const createdAtIso = sql<string>`to_char(${messages.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// A steered user message continues the running turn instead of opening a new one.
const isSteer = sql<boolean>`coalesce((${messages.metadata}->>'steer')::boolean, false)`;

const isRoundStart = (row: WindowRow) => row.role === 'user' && !row.steer;

/**
 * `(createdAt, id)` strictly before the cursor — the "older than" half-open
 * bound. Compares against the cursor's lossless microsecond string cast to
 * `timestamptz`, so sub-millisecond boundaries stay exact.
 */
export const messageStrictlyBefore = (cursor: MessageRoundCursor) =>
  or(
    sql`${messages.createdAt} < ${cursor.createdAt}::timestamptz`,
    and(sql`${messages.createdAt} = ${cursor.createdAt}::timestamptz`, lt(messages.id, cursor.id)),
  );

/** `(createdAt, id)` strictly after the cursor — the "newer than" half-open bound. */
export const messageStrictlyAfter = (cursor: MessageRoundCursor) =>
  or(
    sql`${messages.createdAt} > ${cursor.createdAt}::timestamptz`,
    and(sql`${messages.createdAt} = ${cursor.createdAt}::timestamptz`, gt(messages.id, cursor.id)),
  );

/** `(createdAt, id)` at or after the lower bound — the inclusive window start. */
export const messageAtOrAfter = (bound: RowBound) =>
  or(
    sql`${messages.createdAt} > ${bound.createdAt}::timestamptz`,
    and(sql`${messages.createdAt} = ${bound.createdAt}::timestamptz`, gte(messages.id, bound.id)),
  );

/**
 * Resolve the round window for a backward cursor page: walk mainline rows
 * newest-first and stop at the `roundLimit`-th round boundary (a `user` message)
 * or the `countBudget` safety cap, whichever comes first. Returns the lower bound
 * (the oldest included round's start) and whether older rounds remain. Rows
 * folded into a message group never count toward the window.
 */
const resolveBackwardRoundWindow = async (
  db: LobeChatDatabase,
  {
    countBudget,
    cursor,
    roundLimit,
    where,
  }: {
    countBudget: number;
    cursor?: MessageRoundCursor | null;
    roundLimit: number;
    where: SQL | undefined;
  },
): Promise<{ hasMore: boolean; lowerBound: RowBound | null }> => {
  const olderThanCursor = cursor ? messageStrictlyBefore(cursor) : undefined;

  const rows = (await db
    .select({ createdAtIso, id: messages.id, role: messages.role, steer: isSteer })
    .from(messages)
    .where(and(where, isNull(messages.messageGroupId), olderThanCursor))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(countBudget + 1)) as WindowRow[];

  if (rows.length === 0) return { hasMore: false, lowerBound: null };

  let rounds = 0;
  let boundaryIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (isRoundStart(rows[i])) {
      rounds += 1;
      boundaryIndex = i;
      if (rounds >= roundLimit) break;
    }
    // Safety cap: once a full budget has been walked and at least one whole
    // round is captured, stop at the last boundary instead of scanning further.
    if (i + 1 >= countBudget && rounds >= 1) break;
  }

  // The newest round is larger than the budget: extend the window to its start
  // so the page never begins mid-round (the renderer would root the cut-off
  // steps as orphan chains).
  if (boundaryIndex === -1 && rows.length > countBudget) {
    const [roundStart] = (await db
      .select({ createdAtIso, id: messages.id, role: messages.role, steer: isSteer })
      .from(messages)
      .where(
        and(
          where,
          isNull(messages.messageGroupId),
          olderThanCursor,
          sql`${messages.role} = 'user'`,
          sql`not ${isSteer}`,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1)) as WindowRow[];

    if (roundStart) {
      const lowerBound = { createdAt: roundStart.createdAtIso, id: roundStart.id };
      const [older] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(where, isNull(messages.messageGroupId), messageStrictlyBefore(lowerBound)))
        .limit(1);

      return { hasMore: !!older, lowerBound };
    }
  }

  // No round start anywhere older than the cursor: fall back to the oldest
  // fetched row.
  if (boundaryIndex === -1) boundaryIndex = rows.length - 1;

  const boundaryRow = rows[boundaryIndex];
  const hasMore = boundaryIndex < rows.length - 1 || rows.length > countBudget;

  return { hasMore, lowerBound: { createdAt: boundaryRow.createdAtIso, id: boundaryRow.id } };
};

/**
 * Resolve the round window for a forward cursor page: walk mainline rows
 * oldest-first after the cursor and end just before the `(roundLimit + 1)`-th
 * round start. A page that starts mid-round (the previous page split it) counts
 * that continuation as its first round. Once `countBudget` rows are walked the
 * page ends at the last round boundary it holds; when the first round alone is
 * larger, the page ends at the cap and the next page continues the round.
 * Returns the first row past the page (the exclusive upper bound) and the last
 * row in it (the next cursor).
 */
const resolveForwardRoundWindow = async (
  db: LobeChatDatabase,
  {
    countBudget,
    cursor,
    roundLimit,
    where,
  }: {
    countBudget: number;
    cursor?: MessageRoundCursor | null;
    roundLimit: number;
    where: SQL | undefined;
  },
): Promise<{ first: RowBound | null; last: RowBound | null; upperBound: RowBound | null }> => {
  const newerThanCursor = cursor ? messageStrictlyAfter(cursor) : undefined;

  const rows = (await db
    .select({ createdAtIso, id: messages.id, role: messages.role })
    .from(messages)
    .where(and(where, isNull(messages.messageGroupId), newerThanCursor))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(countBudget + 1)) as WindowRow[];

  if (rows.length === 0) return { first: null, last: null, upperBound: null };

  let rounds = 0;
  let lastBoundary = -1;
  let end = rows.length;
  for (let i = 0; i < rows.length; i += 1) {
    if (i === 0 || rows[i].role === 'user') {
      rounds += 1;
      if (rounds > roundLimit) {
        end = i;
        break;
      }
      if (i > 0) lastBoundary = i;
    }
    if (i + 1 >= countBudget) {
      end = lastBoundary > 0 ? lastBoundary : i + 1;
      break;
    }
  }

  const toBound = (row: WindowRow): RowBound => ({ createdAt: row.createdAtIso, id: row.id });

  return {
    first: toBound(rows[0]),
    last: toBound(rows[end - 1]),
    upperBound: end < rows.length ? toBound(rows[end]) : null,
  };
};

export interface CursorPageWindow {
  /** MessageGroup nodes assembled with this page; see `MessageGroupNodeWindow`. */
  groupNodeWindow: MessageGroupNodeWindow;
  hasMore: boolean;
  /** Cursor for the next page in the same direction, or null at the end. */
  nextCursor: MessageRoundCursor | null;
  /** The page's mainline rows, or `false` for a group-only page. */
  where: SQL | undefined;
}

/**
 * The rows and group nodes of one cursor page. `mainlineWhere` selects the
 * topic's mainline; `scopeWhere` adds the caller's ownership scope for the
 * window walk.
 */
export const resolveCursorPageWindow = async (
  db: LobeChatDatabase,
  {
    countBudget,
    cursor,
    direction,
    mainlineWhere,
    roundLimit,
    scopeWhere,
  }: {
    countBudget: number;
    cursor?: MessageRoundCursor | null;
    direction: 'backward' | 'forward';
    mainlineWhere: SQL | undefined;
    roundLimit: number;
    scopeWhere: SQL | undefined;
  },
): Promise<CursorPageWindow> => {
  const windowWhere = and(scopeWhere, mainlineWhere);

  if (direction === 'forward') {
    const { first, last, upperBound } = await resolveForwardRoundWindow(db, {
      countBudget,
      cursor,
      roundLimit,
      where: windowWhere,
    });
    const hasMore = !!upperBound;

    return {
      // Adjacent pages share a boundary: this page's `before` is the next page's
      // own first row, which that page uses as `from`, so a group dated between
      // two pages lands on exactly one of them. The first page leaves the lower
      // side open and the last page the upper side.
      groupNodeWindow: {
        before: upperBound?.createdAt ?? null,
        from: cursor && first ? first.createdAt : null,
      },
      hasMore,
      nextCursor: hasMore ? last : null,
      where: first
        ? and(
            mainlineWhere,
            cursor ? messageStrictlyAfter(cursor) : undefined,
            upperBound ? messageStrictlyBefore(upperBound) : undefined,
          )
        : sql`false`,
    };
  }

  const { lowerBound, hasMore } = await resolveBackwardRoundWindow(db, {
    countBudget,
    cursor,
    roundLimit,
    where: windowWhere,
  });

  return {
    // MessageGroup nodes (compression / comparison) are partitioned across pages
    // by the same `[lowerBound, cursor)` window as mainline rows, so each group is
    // emitted exactly once over a full backward walk. The oldest page (`!hasMore`)
    // leaves the lower side open so groups dated before the first remaining
    // mainline row — including a topic whose whole history was compressed — stay
    // reachable instead of vanishing.
    groupNodeWindow: {
      before: cursor?.createdAt ?? null,
      from: hasMore && lowerBound ? lowerBound.createdAt : null,
    },
    hasMore,
    // `lowerBound.createdAt` is already the lossless microsecond cursor string.
    nextCursor: hasMore && lowerBound ? lowerBound : null,
    // No lower bound means no mainline rows remain — either the topic has none
    // (e.g. compression moved every message into a group) or nothing older than
    // the cursor is left. The page is then group-only: fetch no mainline rows (an
    // unbounded `where` would wrongly reload the entire topic) but still assemble
    // the remaining group nodes.
    //
    // Otherwise bound the window on BOTH sides: at/after the resolved round start,
    // and — when paging older — strictly before the cursor. Without the upper
    // bound the window would also re-include every newer round already loaded.
    where: lowerBound
      ? and(
          mainlineWhere,
          messageAtOrAfter(lowerBound),
          cursor ? messageStrictlyBefore(cursor) : undefined,
        )
      : sql`false`,
  };
};
