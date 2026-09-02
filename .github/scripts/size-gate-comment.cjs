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
 */
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
### ${failed ? '❌' : '✅'} Bundle Size Gate — ${title}

${report}

---
*Baseline: latest \`canary\` build (workflow artifact). Thresholds configurable via \`SIZE_GATE_PERCENT\` / \`SIZE_GATE_FLOOR_BYTES\`.*`;

  const { data: comments } = await github.rest.issues.listComments({
    issue_number: number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  });

  const existing = comments.find((comment) => comment.body.includes(commentIdentifier));

  if (existing) {
    await github.rest.issues.updateComment({
      body,
      comment_id: existing.id,
      owner: context.repo.owner,
      repo: context.repo.repo,
    });
    console.log(`Updated existing comment ID: ${existing.id}`);
    return { id: existing.id, updated: true };
  }

  const result = await github.rest.issues.createComment({
    body,
    issue_number: number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  });
  console.log(`Created new comment ID: ${result.data.id}`);
  return { id: result.data.id, updated: false };
};

module.exports = sizeGateComment;
