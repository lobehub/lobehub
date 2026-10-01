import type { GoalGraphEvent } from '@lobechat/types';
import dayjs from 'dayjs';

import { type LifecyclePresentation, nodeTwinKey, presentLifecycleEvent } from './lifecycleEvent';

/**
 * Shaping the goal's event trail into timeline rows.
 *
 * The trail is written by the coordinator for bookkeeping, so one human moment
 * can arrive as several near-identical rows: a settle attaches each deliverable
 * with its own event, and a long-lived resource that several nodes touched used
 * to be re-declared as "produced" on every one of them. Two folds turn that
 * back into what happened:
 *
 * - **One claim per deliverable.** A Work is declared produced once, by the
 *   node that first delivered it. Later `produced` claims on the same Work are
 *   bookkeeping about a revision, not another delivery, and they are dropped.
 *   This mirrors the coordinator's own rule
 *   (`GoalService.attachTaskDeliverables`) and also cleans up histories written
 *   before it. A later `input` / `supports` / `contradicts` link is a different
 *   transition in that Work's life and keeps its row.
 * - **One row per moment.** Adjacent deliverable rows of the same node and the
 *   same action that share a displayed time read as one event carrying several
 *   outputs, which is what a settle with five deliverables actually was.
 */

export interface LifecycleRow {
  event: GoalGraphEvent;
  presentation: Exclude<LifecyclePresentation, { hidden: true }>;
}

/** Rows a person reads as one line: one event, or one settle's batch of them. */
export interface LifecycleGroup {
  /** Newest first. The first row supplies the actor, action, subject and time. */
  rows: LifecycleRow[];
}

export interface LifecycleDay {
  day: dayjs.Dayjs;
  groups: LifecycleGroup[];
}

export interface LifecycleRowContext {
  /** Work a linked version belongs to — the deliverable's identity. */
  workIdOf: (workVersionId: string) => string | undefined;
  /** Type of the Work behind a Work version id, when the graph joined it. */
  workTypeOf: (workVersionId: string) => string | undefined;
}

/** The node a deliverable row names, so rows about one subject can merge. */
const subjectKeyOf = (row: LifecycleRow) =>
  row.presentation.action?.startsWith('work.') ? row.event.entityId : undefined;

/**
 * Deliverable claims to drop: for each Work, every row but its earliest claim.
 *
 * Scanned oldest-first because "who delivered it" is decided by who claimed it
 * first, not by where it happens to sit in the newest-first list.
 */
const redundantClaims = (rows: LifecycleRow[], { workIdOf }: LifecycleRowContext) => {
  const claimed = new Set<string>();
  const redundant = new Set<string>();
  for (const row of [...rows].reverse()) {
    // Only a repeated *produced* claim is bookkeeping. The same version later
    // reattached as `input` — `GoalExplorationModel` does exactly that — or as
    // `supports` / `contradicts`, is a new transition in the Work's life, so
    // its row is not a duplicate of the delivery.
    if (row.presentation.action !== 'work.produced') continue;
    const version = row.presentation.workVersion;
    if (!version) continue;
    const workId = workIdOf(version.id);
    if (!workId) continue;
    if (claimed.has(workId)) redundant.add(row.event.id);
    else claimed.add(workId);
  }
  return redundant;
};

export const buildLifecycleDays = (
  events: GoalGraphEvent[],
  context: LifecycleRowContext,
): LifecycleDay[] => {
  const nodeTwins = new Set(
    events.filter((event) => event.entityType === 'node' && event.reason).map(nodeTwinKey),
  );

  const rows: LifecycleRow[] = [...events]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .flatMap((event) => {
      const presentation = presentLifecycleEvent(event, {
        hasNodeTwin: event.entityType === 'goal' && nodeTwins.has(nodeTwinKey(event)),
        workTypeOf: context.workTypeOf,
      });
      // Bookkeeping rows are dropped before grouping so a day holding nothing
      // else does not leave an empty header behind.
      return presentation.hidden ? [] : [{ event, presentation }];
    });

  // Drop the redundant claims before folding, so a dropped row cannot carry a
  // neighbouring row into a merge that no longer makes sense.
  const redundant = redundantClaims(rows, context);

  const days: LifecycleDay[] = [];
  for (const row of rows) {
    if (redundant.has(row.event.id)) continue;

    const day = dayjs(row.event.createdAt).startOf('day');
    const current = days.at(-1);
    if (!current || !current.day.isSame(day)) {
      days.push({ day, groups: [{ rows: [row] }] });
      continue;
    }

    const last = current.groups.at(-1)!;
    if (merges(last, row)) last.rows.push(row);
    else current.groups.push({ rows: [row] });
  }

  return days;
};

/** Same node, same action, same displayed time — one event with several outputs. */
const merges = (group: LifecycleGroup, row: LifecycleRow) => {
  const head = group.rows[0];
  const subject = subjectKeyOf(head);
  if (!subject || subjectKeyOf(row) !== subject) return false;
  if (head.presentation.action !== row.presentation.action) return false;
  // The row prints `HH:mm`, so that is the granularity at which two rows look
  // like the same moment; merging beyond it would fold unrelated rounds.
  return dayjs(head.event.createdAt).format('HH:mm') === dayjs(row.event.createdAt).format('HH:mm');
};
