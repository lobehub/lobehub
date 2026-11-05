import type { LinearIssueComment } from './issues';

/** Who wrote a Linear comment, as Linear shows it. */
export const linearCommentAuthor = (comment: LinearIssueComment): string =>
  comment.user?.displayName ||
  comment.user?.name ||
  comment.externalUser?.name ||
  comment.botActor?.userDisplayName ||
  comment.botActor?.name ||
  'Linear';

/** Keeps a name from being read as markdown emphasis or a link. */
const escapeMarkdown = (text: string) => text.replaceAll(/([*_[\]`\\])/g, '\\$1');

/**
 * A Linear comment as a task comment. The task comment is posted by the
 * person who ran the sync, so the first line credits the Linear author and
 * links back to the original.
 */
export const linearCommentToContent = (comment: LinearIssueComment): string => {
  const author = `**${escapeMarkdown(linearCommentAuthor(comment))}**`;
  const source = `[Linear](${comment.url})`;
  const header = comment.parentId ? `> ${author} replied on ${source}` : `> ${author} on ${source}`;
  const body = comment.body.trim();
  return body ? `${header}\n\n${body}` : header;
};
