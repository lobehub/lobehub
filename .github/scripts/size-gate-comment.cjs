/**
 * Upsert a PR comment with the bundle size gate report.
 * Follows the same identifier-based update-or-create pattern as pr-comment.js.
 *
 * Usage (inside actions/github-script):
 *   const comment = require('<workspace>/.github/scripts/size-gate-comment.cjs');
 *   await comment({ github, context, title: 'Web dist', report, failed, identifier: 'web', issueNumber });
 *
 * `identifier` keeps one comment per gate: the web (e2e) and desktop (asar)
 * workflows run independently on the same PR and must not overwrite each other.
 *
 * A passing gate folds the whole report into a collapsed `<details>` so a green PR shows
 * one summary line instead of a multi-table block — one per gate, not per check. A failing
 * gate stays inline: nobody should have to expand a fold to find the offending entry.
 *
 * A failing gate also submits a REQUEST_CHANGES review from github-actions so the
 * job itself can stay green; a passing run dismisses that review again.
 */
const FOOTER = `---
*Baseline: latest \`canary\` build (workflow artifact). Thresholds configurable via \`SIZE_GATE_PERCENT\` / \`SIZE_GATE_FLOOR_BYTES\` / \`SIZE_GATE_JS_CHUNK_PERCENT\`.*`;

/**
 * Summary line for the folded state. Built from the report's own `### ` headings, so the
 * line can only claim checks the report actually contains; the per-check metrics stay in
 * those headings, one click away.
 */
const summarize = ({ report, title }) => {
  const headings = report
    .split('\n')
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).trim());
  const skipped = headings.filter((heading) => heading.startsWith('⚠️')).length;
  const passed = headings.filter((heading) => heading.startsWith('✅')).length;
  const icon = skipped > 0 ? '⚠️' : '✅';

  // No headings means the report never got produced (an earlier step failed, or the run
  // was cancelled). That is not a pass, and folding the only explanation away would hide it.
  if (headings.length === 0) return `⚠️ Bundle Size Gate — ${title} — expand for the details`;

  const detail =
    skipped > 0
      ? `${passed} of ${headings.length} checks passed — expand for why`
      : `${headings.length} ${headings.length === 1 ? 'check' : 'checks'} passed — expand for the tables`;

  return `${icon} Bundle Size Gate — ${title} · ${detail}`;
};

/** A passing gate folds into one line; a failing gate is rendered expanded, never folded. */
const buildCommentBody = ({ failed, report, title }) => {
  if (failed) return `### ❌ Bundle Size Gate — ${title}\n\n${report}\n\n${FOOTER}`;

  return `<details>\n<summary>${summarize({ report, title })}</summary>\n\n${report}\n\n${FOOTER}\n\n</details>`;
};

const sizeGateComment = async ({
  github,
  context,
  title,
  report,
  failed,
  identifier,
  issueNumber,
}) => {
  const number = issueNumber ?? context.issue.number;
  if (!identifier)
    throw new Error('sizeGateComment requires an `identifier` (e.g. "web" | "asar")');
  const commentIdentifier = `<!-- SIZE-GATE-COMMENT-${identifier} -->`;

  const body = `${commentIdentifier}
${buildCommentBody({ failed, report, title })}`;

  const { data: comments } = await github.rest.issues.listComments({
    issue_number: number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  });

  const existing = comments.find((comment) => comment.body.includes(commentIdentifier));

  let commentId;
  if (existing) {
    await github.rest.issues.updateComment({
      body,
      comment_id: existing.id,
      owner: context.repo.owner,
      repo: context.repo.repo,
    });
    commentId = existing.id;
  } else {
    const created = await github.rest.issues.createComment({
      body,
      issue_number: number,
      owner: context.repo.owner,
      repo: context.repo.repo,
    });
    commentId = created.data.id;
  }
  console.log(`${existing ? 'Updated' : 'Created'} comment ID: ${commentId}`);

  await syncReview({ commentId, context, failed, github, identifier, number, title });

  return { id: commentId, updated: Boolean(existing) };
};

const syncReview = async ({ github, context, number, title, failed, identifier, commentId }) => {
  const marker = `<!-- SIZE-GATE-REVIEW-${identifier} -->`;
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    ...repo,
    pull_number: number,
  });
  const open = reviews.filter(
    (review) => review.state === 'CHANGES_REQUESTED' && review.body?.includes(marker),
  );

  if (!failed) {
    for (const review of open) {
      await github.rest.pulls.dismissReview({
        ...repo,
        message: `Bundle Size Gate — ${title} passes on the latest build.`,
        pull_number: number,
        review_id: review.id,
      });
      console.log(`Dismissed size gate review ID: ${review.id}`);
    }
    return;
  }

  const reportUrl = `https://github.com/${repo.owner}/${repo.repo}/pull/${number}#issuecomment-${commentId}`;
  const body = `${marker}
### ❌ Bundle Size Gate — ${title}

The size gate failed on the latest build. See the [report](${reportUrl}) for the offending entries; this review is dismissed automatically once the gate passes again.`;

  if (open.length > 0) {
    await github.rest.pulls.updateReview({
      ...repo,
      body,
      pull_number: number,
      review_id: open[0].id,
    });
    console.log(`Updated size gate review ID: ${open[0].id}`);
    return;
  }

  const created = await github.rest.pulls.createReview({
    ...repo,
    body,
    event: 'REQUEST_CHANGES',
    pull_number: number,
  });
  console.log(`Requested changes via review ID: ${created.data.id}`);
};

module.exports = sizeGateComment;
module.exports.buildCommentBody = buildCommentBody;
module.exports.summarize = summarize;
