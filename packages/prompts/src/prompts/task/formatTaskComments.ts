import type { TaskDetailActivity, TaskDetailData } from '@lobechat/types';

/**
 * How many of the newest comments viewTask prints with their body. Periodic
 * tasks keep state (dedup ledgers, round notes) in comments, so the recent
 * ones must be readable; older ones stay as one-line previews to bound the
 * tool result on tasks with hundreds of rounds.
 */
export const TASK_DETAIL_COMMENT_BODY_COUNT = 20;
/** Per-comment body cap in viewTask; longer comments are read with `commentId`. */
export const TASK_DETAIL_COMMENT_BODY_LIMIT = 1000;
const TASK_DETAIL_COMMENT_PREVIEW_LIMIT = 80;

const commentAuthor = (act: TaskDetailActivity): string => {
  const kind = act.agentId || act.author?.type === 'agent' ? '🤖 agent' : '👤 user';
  const name = act.author?.name || act.author?.id || act.agentId;
  return name ? `${kind} ${name}` : kind;
};

const continuation = (t: TaskDetailData, act: TaskDetailActivity, length: number): string =>
  act.id
    ? `[truncated, ${length} chars total — read it with viewTask({ identifier: "${t.identifier}", commentId: "${act.id}" })]`
    : `[truncated, ${length} chars total]`;

/**
 * The comments viewTask prints with their body: the newest
 * `TASK_DETAIL_COMMENT_BODY_COUNT`, regardless of the activity order.
 */
export const selectCommentsWithBody = (activities: TaskDetailActivity[]): Set<TaskDetailActivity> =>
  new Set(
    activities
      .filter((a) => a.type === 'comment')
      .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
      .slice(0, TASK_DETAIL_COMMENT_BODY_COUNT),
  );

/**
 * One line under `Activities:` when some comments are previews only — said
 * once instead of on every preview line, which would grow with every round.
 */
export const commentPreviewHint = (
  activities: TaskDetailActivity[],
  withBody: Set<TaskDetailActivity>,
): string | undefined => {
  const previews = activities.filter((a) => a.type === 'comment').length - withBody.size;
  if (previews <= 0) return undefined;
  return `  (${previews} older comment${previews === 1 ? '' : 's'} shown as one-line previews; pass viewTask commentId to read one in full)`;
};

/** Render one comment activity for the viewTask Activities list. */
export const formatCommentActivity = (
  t: TaskDetailData,
  act: TaskDetailActivity,
  withBody: boolean,
): string[] => {
  const idSuffix = act.id ? `  ${act.id}` : '';
  const header = `  💭 ${act.time || ''} ${commentAuthor(act)}`;
  const content = act.content || '';

  if (!withBody) {
    const preview = content.replaceAll(/\s+/g, ' ').trim();
    const truncated =
      preview.length > TASK_DETAIL_COMMENT_PREVIEW_LIMIT
        ? `${preview.slice(0, TASK_DETAIL_COMMENT_PREVIEW_LIMIT)}...`
        : preview;
    return [`${header} ${truncated}${idSuffix}`];
  }

  const body =
    content.length > TASK_DETAIL_COMMENT_BODY_LIMIT
      ? `${content.slice(0, TASK_DETAIL_COMMENT_BODY_LIMIT)}...\n${continuation(t, act, content.length)}`
      : content;
  return [`${header}${idSuffix}`, ...body.split('\n').map((line) => `      ${line}`)];
};

/**
 * Full body of one task comment — the continuation path for comments that
 * viewTask's Activities list truncates.
 */
export const formatTaskComment = (t: TaskDetailData, commentId: string): string | undefined => {
  const act = t.activities?.find((a) => a.type === 'comment' && a.id === commentId);
  if (!act) return undefined;

  return [
    `Comment ${commentId} on ${t.identifier}`,
    `Author: ${commentAuthor(act)}`,
    `Time: ${act.time || '-'}`,
    '',
    act.content || '',
  ].join('\n');
};
