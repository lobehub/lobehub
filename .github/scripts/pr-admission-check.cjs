/**
 * PR admission check: labels and comments on pull requests whose description has no
 * acceptance evidence, the part of the merge standard (CI passing + Codex review approval +
 * acceptance evidence) that CI and Codex cannot check themselves.
 *
 * Only the evidence is required, not the template's exact layout: many maintainers write
 * their own `## Acceptance` / `## Verification` sections, and flagging those would bury the
 * PRs that really lack evidence. Template-only fields (contribution source, test boxes) and
 * title format are left to review.
 *
 * The verdict is deterministic on purpose — no model calls — so contributors get the same
 * result on every run, and `pr-stale.yml` can close long-incomplete PRs based on the label.
 *
 * Usage (inside actions/github-script):
 *   const check = require('<workspace>/.github/scripts/pr-admission-check.cjs');
 *   await check.run({ github, context });                          // on PR events
 *   await check.closeIncomplete({ core, dryRun, github, context }); // on a schedule
 */
const LABEL = 'pr:incomplete';
const KEEP_OPEN_LABEL = 'keep-open';
const INCOMPLETE_CLOSE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const MARKER = '<!-- PR-ADMISSION-CHECK -->';
const TEMPLATE_URL =
  'https://github.com/lobehub/lobehub/blob/canary/.github/PULL_REQUEST_TEMPLATE.md';

const fs = require('node:fs');
const path = require('node:path');

/** Automation accounts that open PRs without the template (i18n, dependency bumps). */
const EXEMPT_LOGINS = new Set(['lobehubbot']);

/**
 * Team members are held to the merge standard in review, not by this check; it targets
 * outside contributions. `author_association` covers org members and collaborators, but
 * GitHub reports private org members as `CONTRIBUTOR` in event payloads, so the maintainer
 * list (also used by `claude-pr-assign.yml`) backs it up.
 */
const TEAM_ASSOCIATIONS = new Set(['COLLABORATOR', 'MEMBER', 'OWNER']);
const MAINTAINERS = new Set(
  fs
    .readFileSync(path.join(__dirname, '../maintainers.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean),
);

/** Template placeholders and bare opt-outs that carry no evidence or reason. */
const EMPTY_VALUES = new Set(['', '...', '…', '-', 'n/a', 'na', 'none', 'todo', 'tbd']);

/** `Acceptance:` field from the template, optionally bold or in a list item. */
const ACCEPTANCE_FIELD = /^[\t ]*(?:[*-][\t ]*)?(?:\*\*)?acceptance(?:\*\*)?:(.*)$/gim;

/** Free-form sections maintainers use instead of the field, in English or Chinese. */
const EVIDENCE_HEADING =
  /^#{1,6}[\t ].*(?:\b(?:acceptance|verification|test(?:s|ing| plan)?|how to test)\b|验收|验证|测试).*$/gim;

/** A published acceptance round is evidence wherever it appears. */
const ACCEPTANCE_LINK = /https:\/\/(?:app\.)?lobehub\.com\/acceptance\/[\w-]+/i;

/**
 * Drops what GitHub hides when rendering: HTML comments, and everything after an unclosed
 * `<!--`. Scans by index rather than with a regex replace so no comment opener survives.
 */
const stripComments = (text) => {
  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<!--', cursor);
    if (start === -1) return result + text.slice(cursor);
    result += text.slice(cursor, start);
    const end = text.indexOf('-->', start + 4);
    if (end === -1) return result;
    cursor = end + 3;
  }
  return result;
};

/** Unchecked boxes and the template's own test options say nothing about this change. */
const TEMPLATE_SCAFFOLDING =
  /^\s*[*-]\s+\[(?: |x\]\s*(?:tested locally|added\/updated tests|no tests needed)\s*$)/i;

/**
 * Collapses a value to plain lowercase text without list markers or markdown emphasis.
 * Template scaffolding and placeholder-only lines (`- TODO`, `...`) are dropped line by line,
 * so a section made only of placeholders normalizes to an empty string.
 */
const normalize = (value) =>
  value
    .split('\n')
    // Subheadings structure a section but are not evidence themselves.
    .filter((line) => !TEMPLATE_SCAFFOLDING.test(line) && !/^#{1,6}\s/.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[*-]\s+)?/, '')
        .replaceAll(/[*_`]/g, '')
        .trim()
        .toLowerCase(),
    )
    .filter((line) => !EMPTY_VALUES.has(line))
    .join(' ');

/**
 * Text after `index` up to the next heading at `level` or higher, so nested subheadings
 * (`## Acceptance` → `### Local browser`) stay inside the section.
 */
const sectionAfter = (body, index, level = 6) =>
  body.slice(index).split(new RegExp(`^#{1,${level}}\\s`, 'm'))[0];

/** Every place the description may hold acceptance evidence, normalized. */
const readEvidence = (body) => {
  const values = [];
  for (const match of body.matchAll(ACCEPTANCE_FIELD)) {
    const inline = normalize(match[1]);
    // Evidence may follow on the next lines, e.g. a nested list of screenshots.
    values.push(inline || normalize(sectionAfter(body, match.index + match[0].length)));
  }
  for (const match of body.matchAll(EVIDENCE_HEADING)) {
    // The template's `Acceptance:` line sits under `#### Test`; it is judged on its own above.
    const level = match[0].match(/^#+/)[0].length;
    const section = sectionAfter(body, match.index + match[0].length, level).replaceAll(
      ACCEPTANCE_FIELD,
      '',
    );
    values.push(normalize(section));
  }
  return values;
};

const isEvidence = (value) => {
  if (EMPTY_VALUES.has(value)) return false;
  const optOutReason = value.match(/^not needed:?(.*)$/)?.[1]?.trim();
  return optOutReason === undefined || !EMPTY_VALUES.has(optOutReason);
};

/**
 * Returns the problems found in a PR description, in display order. An empty array means
 * the PR meets the admission requirements.
 */
const findProblems = ({ body = '' }) => {
  const content = stripComments(body ?? '');
  if (ACCEPTANCE_LINK.test(content) || readEvidence(content).some(isEvidence)) return [];
  return [
    'Acceptance evidence: fill `Acceptance` with an acceptance round link, screenshots, recordings, or the steps you used to verify the change; or write `Not needed: <reason>`.',
  ];
};

const isTeamMember = (pr) =>
  TEAM_ASSOCIATIONS.has(pr.author_association) || MAINTAINERS.has(pr.user?.login?.toLowerCase());

/**
 * PRs the check skips: drafts, bots, team members, and PRs from the release flow — weekly
 * releases and main→canary syncs (`🚀 release:` titles), and hotfix or migration-forward
 * branches (`hotfix/*`, `release/*`).
 */
const isExempt = (pr) =>
  pr.draft ||
  pr.user?.type === 'Bot' ||
  EXEMPT_LOGINS.has(pr.user?.login) ||
  isTeamMember(pr) ||
  /^🚀\s*release:/u.test(pr.title ?? '') ||
  /^(?:hotfix|release)\//.test(pr.head?.ref ?? '');

const buildComment = (problems) => `${MARKER}
👋 Thanks for the PR! Before review, the description needs what the merge standard relies on (CI passing + Codex review approval + acceptance evidence):

${problems.map((problem) => `- [ ] ${problem}`).join('\n')}

See the [pull request template](${TEMPLATE_URL}); an \`## Acceptance\` or \`## Verification\` section works too. This check reruns when you edit the description, and removes the \`${LABEL}\` label once the evidence is there.

PRs that stay \`${LABEL}\` are closed after ${INCOMPLETE_CLOSE_DAYS} days without activity.`;

const CLOSE_COMMENT = `Closing because the description has had no acceptance evidence and no activity for ${INCOMPLETE_CLOSE_DAYS} days. Feel free to reopen after adding it.`;

const run = async ({ github, context }) => {
  const pr = context.payload.pull_request;
  if (!pr || isExempt(pr)) return;

  const { owner, repo } = context.repo;
  const issue_number = pr.number;
  const problems = findProblems({ body: pr.body });

  const comments = await github.paginate(github.rest.issues.listComments, {
    issue_number,
    owner,
    per_page: 100,
    repo,
  });
  const existing = comments.find((comment) => comment.body?.startsWith(MARKER));
  const hasLabel = pr.labels?.some((label) => label.name === LABEL);

  if (problems.length > 0) {
    if (!hasLabel) {
      await github.rest.issues.addLabels({ issue_number, labels: [LABEL], owner, repo });
    }
    const body = buildComment(problems);
    if (!existing) {
      await github.rest.issues.createComment({ body, issue_number, owner, repo });
    } else if (existing.body !== body) {
      await github.rest.issues.updateComment({ body, comment_id: existing.id, owner, repo });
    }
    return;
  }

  if (hasLabel) {
    try {
      await github.rest.issues.removeLabel({ issue_number, name: LABEL, owner, repo });
    } catch (error) {
      // Someone removed the label between the event and this run.
      if (error.status !== 404) throw error;
    }
  }
  if (existing) {
    await github.rest.issues.deleteComment({ comment_id: existing.id, owner, repo });
  }
};

/** Current-state check for a close candidate found by search. */
const shouldClose = (pr, cutoff) => {
  const labels = new Set(pr.labels?.map((label) => label.name));
  return (
    pr.state === 'open' &&
    !isExempt(pr) &&
    labels.has(LABEL) &&
    !labels.has(KEEP_OPEN_LABEL) &&
    new Date(pr.updated_at) < cutoff &&
    findProblems({ body: pr.body }).length > 0
  );
};

/**
 * Closes open PRs still labeled incomplete after the grace period. Runs from `pr-stale.yml`
 * instead of a second actions/stale pass: actions/stale keeps its scan cursor under one fixed
 * cache key, so two passes in the same repository skip each other's candidates.
 */
const closeIncomplete = async ({ core, dryRun, github, context, now = new Date() }) => {
  const { owner, repo } = context.repo;
  const cutoff = new Date(now.getTime() - INCOMPLETE_CLOSE_DAYS * DAY_MS);
  const q = `repo:${owner}/${repo} is:pr is:open -is:draft label:"${LABEL}" -label:"${KEEP_OPEN_LABEL}" updated:<${cutoff.toISOString().slice(0, 10)}`;
  const items = await github.paginate(github.rest.search.issuesAndPullRequests, {
    per_page: 100,
    q,
  });

  const closed = [];
  for (const { number } of items) {
    // Search results can be stale; re-read the PR so one fixed or exempted since then stays open.
    const { data: pr } = await github.rest.pulls.get({ owner, pull_number: number, repo });
    if (!shouldClose(pr, cutoff)) continue;

    closed.push(number);
    if (dryRun) {
      core.info(`[dry-run] would close #${number}`);
      continue;
    }
    await github.rest.issues.createComment({
      body: CLOSE_COMMENT,
      issue_number: number,
      owner,
      repo,
    });
    await github.rest.pulls.update({ owner, pull_number: number, repo, state: 'closed' });
    core.info(`closed #${number}`);
  }

  return closed;
};

module.exports = { LABEL, MARKER, closeIncomplete, findProblems, isExempt, run };
