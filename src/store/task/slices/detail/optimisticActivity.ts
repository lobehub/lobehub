import type { TaskDetailActivity, TaskDetailActivityAuthor } from '@lobechat/types';

/**
 * Distinguishes a locally synthesized row from a persisted one until the
 * refetch replaces it. Renderers use it to withhold actions (edit / delete)
 * that would otherwise hit the server with an id it has never seen.
 */
export const OPTIMISTIC_ACTIVITY_ID_PREFIX = 'optimistic-';

export const isOptimisticActivityId = (id?: string | null): boolean =>
  !!id && id.startsWith(OPTIMISTIC_ACTIVITY_ID_PREFIX);

export interface BuildOptimisticAssignmentInput {
  /** Who is making the change; without one no row is synthesized rather than inventing an actor. */
  actor?: TaskDetailActivityAuthor;
  /** `undefined` = slot untouched, `null` = cleared. Mirrors `TaskUpdatePayload`. */
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  /** The assignees before this edit, for the no-op check and the `from` side. */
  current: { agentId?: string | null; userId?: string | null };
  now: string;
  /** Display metadata for the newly chosen assignee, handed in by the picker that has it. */
  target?: TaskDetailActivityAuthor;
}

/**
 * Synthesize the assignment rows the server is about to persist, so the feed
 * moves in the same beat as the assignee chip instead of two round-trips later.
 *
 * Only a slot that actually changes produces a row — the same rule the server
 * applies — so re-saving the same assignee stays silent here too. The refetch
 * that follows the mutation replaces the whole activity array, which retires
 * these rows without any reconciliation; a failed mutation is rolled back by
 * that same refetch.
 */
export const buildOptimisticAssignmentActivities = ({
  actor,
  assigneeAgentId,
  assigneeUserId,
  current,
  now,
  target,
}: BuildOptimisticAssignmentInput): TaskDetailActivity[] => {
  if (!actor) return [];

  const rows: TaskDetailActivity[] = [];
  const side = (
    id: string | null | undefined,
    type: TaskDetailActivityAuthor['type'],
  ): TaskDetailActivityAuthor | null => {
    if (!id) return null;
    return target?.id === id ? target : { id, name: null, type };
  };

  if (assigneeAgentId !== undefined && assigneeAgentId !== (current.agentId ?? null)) {
    rows.push({
      assignment: {
        from: side(current.agentId, 'agent'),
        kind: 'agent',
        to: side(assigneeAgentId, 'agent'),
      },
      author: actor,
      id: `${OPTIMISTIC_ACTIVITY_ID_PREFIX}assignment-agent-${now}`,
      time: now,
      type: 'assignment',
    });
  }

  if (assigneeUserId !== undefined && assigneeUserId !== (current.userId ?? null)) {
    rows.push({
      assignment: {
        from: side(current.userId, 'user'),
        kind: 'member',
        to: side(assigneeUserId, 'user'),
      },
      author: actor,
      id: `${OPTIMISTIC_ACTIVITY_ID_PREFIX}assignment-member-${now}`,
      time: now,
      type: 'assignment',
    });
  }

  return rows;
};

export interface BuildOptimisticCommentInput {
  actor?: TaskDetailActivityAuthor;
  content: string;
  editorData?: unknown;
  now: string;
  topicId?: string | null;
}

/**
 * The comment the server is about to persist, shown the moment it is sent.
 *
 * Attachments are deliberately absent: their metadata (urls, sizes) only
 * exists after the server has resolved the file ids, so they arrive with the
 * refetch. Agent-authored comments (client-first runtime) are not synthesized
 * — the store has no agent identity to attribute them to.
 */
export const buildOptimisticCommentActivity = ({
  actor,
  content,
  editorData,
  now,
  topicId,
}: BuildOptimisticCommentInput): TaskDetailActivity | undefined => {
  if (!actor) return undefined;
  return {
    author: actor,
    content,
    editorData,
    id: `${OPTIMISTIC_ACTIVITY_ID_PREFIX}comment-${now}`,
    time: now,
    topicId: topicId ?? null,
    type: 'comment',
  };
};

export interface BuildOptimisticPropertyInput {
  actor?: TaskDetailActivityAuthor;
  change: NonNullable<TaskDetailActivity['propertyChange']>;
  now: string;
}

/**
 * A property row (status / priority / automation) shown the moment the pick is
 * made. Same contract as the assignment rows: nothing is synthesized without a
 * known actor, and the refetch that follows retires it.
 */
export const buildOptimisticPropertyActivity = ({
  actor,
  change,
  now,
}: BuildOptimisticPropertyInput): TaskDetailActivity | undefined => {
  if (!actor) return undefined;
  return {
    author: actor,
    id: `${OPTIMISTIC_ACTIVITY_ID_PREFIX}property-${change.field}-${now}`,
    propertyChange: change,
    time: now,
    type: 'property',
  };
};

/**
 * Mirror of the server's collapse window (`ACTIVITY_COLLAPSE_WINDOW_MS` in
 * the task service): how long a run of edits to one property by one person
 * stays a single line. Kept in step by hand — the client cannot import it.
 */
export const OPTIMISTIC_COLLAPSE_WINDOW_MS = 30 * 60_000;

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const at = (time?: string): number => (time ? new Date(time).getTime() : 0);

/**
 * Append a synthesized property row the way the server will show it once it
 * reads back: a second hop on the same field by the same person, straight
 * after the previous synthesized one and inside the collapse window, folds
 * into that row (start of the first, end of the latest) — and vanishes when
 * the value is back where it started. Without this, a path that never
 * refetches (automation toggles) would show every hop until an unrelated
 * refresh made the server's collapsed view replace them.
 */
export const appendOptimisticPropertyActivity = (
  activities: TaskDetailActivity[],
  row: TaskDetailActivity | undefined,
  windowMs: number = OPTIMISTIC_COLLAPSE_WINDOW_MS,
): TaskDetailActivity[] => {
  const next = row?.propertyChange;
  if (!row || !next) return activities;
  const last = activities.at(-1);
  const prev = last?.propertyChange;
  const mergeable =
    !!last &&
    !!prev &&
    isOptimisticActivityId(last.id) &&
    prev.field === next.field &&
    last.author?.id === row.author?.id &&
    at(row.time) - at(last.time) <= windowMs &&
    sameValue(prev.to, next.from);
  if (!mergeable) return [...activities, row];

  const head = activities.slice(0, -1);
  if (sameValue(prev.from, next.to)) return head;
  return [
    ...head,
    {
      ...row,
      propertyChange: { ...next, from: prev.from } as NonNullable<
        TaskDetailActivity['propertyChange']
      >,
    },
  ];
};
