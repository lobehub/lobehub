import type { ScmCheck } from '@lobechat/types';

import type { ScmChangeRequestItem } from '@/database/schemas';

import type { GitHubReviewFeedback } from './github/app';

/** Reasons the control half wakes the agent that opened a change request. */
export type ScmWakeReason = 'ci_failed' | 'review_changes_requested' | 'review_commented';

const header = (row: ScmChangeRequestItem) =>
  `GitHub reported new activity on pull request ${row.repoFullName}#${row.number} (${row.url}), which you opened from this conversation.`;

const footer = (row: ScmChangeRequestItem) =>
  `Work in the same checkout you used for this pull request. Push your fix to the branch \`${row.headRef ?? 'the PR branch'}\` and reply here with a short summary of what changed and why.`;

/**
 * The message an agent receives when a check fails on its pull request. The
 * failing checks come from the stored rollup; job logs, when the fetcher
 * could get them, are quoted so the agent can act without polling GitHub.
 */
export const buildCiFailurePrompt = (params: {
  logs: Record<string, string | null>;
  row: ScmChangeRequestItem;
}): string => {
  const { row, logs } = params;
  const failing = (row.checks ?? []).filter(
    (check: ScmCheck) => check.status === 'completed' && check.conclusion !== 'success',
  );
  const sha = row.headSha ? row.headSha.slice(0, 7) : 'the latest commit';

  const lines = [header(row), '', `CI failed on commit ${sha}:`];
  for (const check of failing) {
    lines.push(
      `- ${check.name}: ${check.conclusion ?? 'failed'}${check.url ? ` (${check.url})` : ''}`,
    );
    const tail = logs[check.externalId];
    if (tail) {
      lines.push('', `Log tail for "${check.name}":`, '```', tail.trimEnd(), '```');
    }
  }
  lines.push('', 'Please investigate the failure and fix it.', footer(row));
  return lines.join('\n');
};

/** The message an agent receives when reviewers request changes or comment. */
export const buildReviewPrompt = (params: {
  feedback: GitHubReviewFeedback[];
  reason: Exclude<ScmWakeReason, 'ci_failed'>;
  row: ScmChangeRequestItem;
}): string => {
  const { row, feedback, reason } = params;
  const lines = [
    header(row),
    '',
    reason === 'review_changes_requested'
      ? 'A reviewer requested changes:'
      : 'Reviewers left feedback:',
  ];
  if (feedback.length === 0) {
    lines.push('(The review had no text; open the pull request to read it.)');
  }
  for (const item of feedback) {
    const where = item.path ? ` on \`${item.path}\`${item.line ? `:${item.line}` : ''}` : '';
    const state = item.state ? ` [${item.state.toLowerCase()}]` : '';
    lines.push(`- @${item.author}${state}${where}: ${item.body.trim()}`);
  }
  lines.push(
    '',
    'Please address each point, or explain in your reply why it should stay as is.',
    footer(row),
  );
  return lines.join('\n');
};
