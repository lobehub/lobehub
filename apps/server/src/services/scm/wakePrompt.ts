import { SCM_EVENT_TAG } from '@lobechat/const';

import { isFailingCheck } from '@/database/models/scm';
import type { ScmChangeRequestItem } from '@/database/schemas';

import type { GitHubReviewFeedback } from './github/app';

/** Reasons the control half wakes the agent that opened a change request. */
export type ScmWakeReason = 'ci_failed' | 'review_changes_requested' | 'review_commented';

/**
 * The wake-up message is one `<scmEvent>` block: attributes name the change
 * request, children carry the checks (with log tails), the review feedback
 * and the instruction. The model reads it as structured context; the client
 * renders it as a card ({@link SCM_EVENT_TAG} markdown plugin).
 *
 * The block must survive markdown parsing as a single HTML block, which
 * CommonMark ends at the first blank line — so nothing here may emit one:
 * quoted text has its blank lines dropped and sits inside CDATA.
 */

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const attributes = (values: Record<string, number | string | null | undefined>) =>
  Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
    .join(' ');

const withoutBlankLines = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .join('\n');

const cdata = (text: string) =>
  `<![CDATA[\n${withoutBlankLines(text).replaceAll(']]>', ']]]]><![CDATA[>')}\n]]>`;

const openTag = (row: ScmChangeRequestItem, kind: ScmWakeReason) =>
  `<${SCM_EVENT_TAG} ${attributes({
    branch: row.headRef,
    kind,
    number: row.number,
    provider: row.provider,
    repo: row.repoFullName,
    sha: row.headSha ? row.headSha.slice(0, 7) : null,
    url: row.url,
  })}>`;

const closeTag = `</${SCM_EVENT_TAG}>`;

const sameCheckout = (row: ScmChangeRequestItem) =>
  `Work in the same checkout you used for this pull request, push the fix to the branch \`${row.headRef ?? 'of the pull request'}\`, and reply here with a short summary of what changed and why.`;

const instruction = (text: string) => `<instruction>\n${withoutBlankLines(text)}\n</instruction>`;

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
  // `cancelled`, `skipped` and `neutral` are completed but not failures;
  // listing them would ask the agent to fix a check that never ran.
  const failing = (row.checks ?? []).filter((check) => isFailingCheck(check));

  const lines = [openTag(row, 'ci_failed')];
  for (const check of failing) {
    const attrs = attributes({
      conclusion: check.conclusion ?? 'failure',
      name: check.name,
      url: check.url,
    });
    const tail = logs[check.externalId]?.trim();
    if (tail) lines.push(`<check ${attrs}>`, `<log>${cdata(tail)}</log>`, '</check>');
    else lines.push(`<check ${attrs} />`);
  }
  lines.push(
    instruction(
      `GitHub reported a failing check on pull request ${row.repoFullName}#${row.number}, which you opened from this conversation. Investigate the failure and fix it. ${sameCheckout(row)}`,
    ),
    closeTag,
  );
  return lines.join('\n');
};

/**
 * Review bots that only look again when asked, keyed by their GitHub login.
 * Codex reviews a pull request once on open; a pushed fix goes unreviewed
 * unless someone comments the command.
 */
const REREVIEW_COMMANDS: Record<string, string> = {
  'chatgpt-codex-connector[bot]': '@codex review',
};

/**
 * Asks the agent to re-request review from the bots that gave this feedback.
 * The comment is posted as the PR author, which the control half skips, so it
 * never wakes the agent itself; a clean re-review is a reaction, not a
 * review, so the loop ends there, and `SCM_MAX_WAKES` bounds it otherwise.
 */
const rereviewRequest = (feedback: GitHubReviewFeedback[]) => {
  const commands = [
    ...new Set(feedback.map((item) => REREVIEW_COMMANDS[item.author]).filter(Boolean)),
  ];
  if (commands.length === 0) return '';
  const list = commands.map((command) => `\`${command}\``).join(' and ');
  return ` If you pushed a fix, then comment ${list} on the pull request so the reviewer checks it again; do not comment it when you changed nothing.`;
};

/** The message an agent receives when reviewers request changes or comment. */
export const buildReviewPrompt = (params: {
  feedback: GitHubReviewFeedback[];
  reason: Exclude<ScmWakeReason, 'ci_failed'>;
  row: ScmChangeRequestItem;
}): string => {
  const { row, feedback, reason } = params;
  const lines = [openTag(row, reason)];
  for (const item of feedback) {
    const attrs = attributes({
      author: item.author,
      line: item.line,
      path: item.path,
      state: item.state?.toLowerCase(),
      url: item.url,
    });
    lines.push(`<review ${attrs}>${cdata(item.body.trim())}</review>`);
  }
  const lead =
    reason === 'review_changes_requested'
      ? `A reviewer requested changes on pull request ${row.repoFullName}#${row.number}, which you opened from this conversation.`
      : `Reviewers left feedback on pull request ${row.repoFullName}#${row.number}, which you opened from this conversation.`;
  const missing =
    feedback.length === 0 ? ' The review carried no text; open the pull request to read it.' : '';
  lines.push(
    instruction(
      `${lead}${missing} Address each point, or explain in your reply why it should stay as is. ${sameCheckout(row)}${rereviewRequest(feedback)}`,
    ),
    closeTag,
  );
  return lines.join('\n');
};
