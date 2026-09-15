import type { TaskActivityLogPayload, TaskActivityLogType } from '@lobechat/types';

/**
 * How long a run of edits to one property by one person stays a single line.
 * A product knob, not a correctness one: shorter shows more intermediate
 * states, longer hides more fiddling.
 */
export const ACTIVITY_COLLAPSE_WINDOW_MS = 30 * 60_000;

interface CollapsibleRow {
  actorAgentId: string | null;
  actorUserId: string | null;
  createdAt: Date | string;
  id: string;
  payload: TaskActivityLogPayload | null;
  type: TaskActivityLogType;
}

const at = (row: CollapsibleRow): number => new Date(row.createdAt).getTime();

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * True when `next` picks up exactly where `prev` left off. A run only extends
 * along an unbroken chain of values: if someone else moved the property in
 * between, the chain is broken and the same person's next edit is a fresh
 * decision — otherwise A's 2→4 and 3→2 around B's 4→3 would fold into a
 * hidden no-op and leave B's row telling a story that never happened.
 */
const continues = (prev: CollapsibleRow, next: CollapsibleRow): boolean =>
  sameValue(prev.payload?.to, next.payload?.from) &&
  (prev.payload?.toId ?? null) === (next.payload?.fromId ?? null);

/** True when the row's start and end are the same value — nothing to tell. */
const isNetNoop = (payload: TaskActivityLogPayload | null): boolean =>
  !!payload &&
  sameValue(payload.from, payload.to) &&
  (payload.fromId ?? null) === (payload.toId ?? null);

/**
 * Fold a burst of edits to the same property by the same person into one
 * entry, the way an issue tracker shows "moved from A to C" rather than every
 * hop in between — and shows nothing at all when the value ended up back where
 * it started.
 *
 * Read-time only. The rows in `task_activities` stay append-only, so the full
 * hop-by-hop history is still there for audit or a "show all" view; this only
 * decides what a reader is shown by default. `rows` must be oldest-first, as
 * `getActivities` returns them.
 *
 * The merged entry keeps the LAST row's id and time (the feed sorts by it and
 * a reader wants "when did it settle"), the FIRST row's starting value, and the
 * last row's ending value. Different actors never merge: A moving it and B
 * moving it back are two decisions, not a cancelled one — a run only extends
 * while each hop starts where the previous one ended, and any edit by someone
 * else ends every other open run on that property.
 */
export const collapseActivityLog = <T extends CollapsibleRow>(
  rows: T[],
  windowMs: number = ACTIVITY_COLLAPSE_WINDOW_MS,
): T[] => {
  const out: T[] = [];
  // Per (property, actor): where the open run sits in `out`, its first row
  // (for the starting value) and its last row (for the sliding window).
  const open = new Map<string, { first: T; index: number; last: T }>();

  for (const row of rows) {
    const key = `${row.type}|${row.actorAgentId ?? ''}|${row.actorUserId ?? ''}`;
    const run = open.get(key);

    if (run && at(row) - at(run.last) <= windowMs && continues(run.last, row)) {
      out[run.index] = {
        ...row,
        payload: {
          ...run.first.payload,
          to: row.payload?.to,
          toId: row.payload?.toId,
        },
      };
      run.last = row;
      continue;
    }

    out.push(row);
    // Anyone touching the property closes everyone else's open run on it:
    // once B has moved it, A's later edit is a reaction to B, not the tail
    // of A's own fiddling — otherwise A 2→4, B 4→3→4, A 4→2 would fold both
    // people's runs into no-ops and show nothing at all.
    for (const otherKey of open.keys()) {
      if (otherKey !== key && otherKey.startsWith(`${row.type}|`)) open.delete(otherKey);
    }
    open.set(key, { first: row, index: out.length - 1, last: row });
  }

  return out.filter((row) => !isNetNoop(row.payload));
};
