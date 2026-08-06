/**
 * Upsert a PR comment with the bundle size gate report.
 * Follows the same identifier-based update-or-create pattern as pr-comment.js.
 *
 * Usage (inside actions/github-script):
 *   const comment = require('<workspace>/.github/scripts/size-gate-comment.js');
 *   await comment({ github, context, title: 'Web Bundle Size (dist)', report, failed });
 */
const COMMENT_IDENTIFIER = '<!-- SIZE-GATE-COMMENT -->';

const sizeGateComment = async ({ github, context, title, report, failed }) => {
  const body = `${COMMENT_IDENTIFIER}
### ${failed ? '❌' : '✅'} Bundle Size Gate — ${title}

${report}

---
*Baseline: latest \`canary\` build (workflow artifact). Thresholds configurable via \`SIZE_GATE_PERCENT\` / \`SIZE_GATE_FLOOR_BYTES\`.*`;

  const { data: comments } = await github.rest.issues.listComments({
    issue_number: context.issue.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  });

  const existing = comments.find((comment) => comment.body.includes(COMMENT_IDENTIFIER));

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
    issue_number: context.issue.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  });
  console.log(`Created new comment ID: ${result.data.id}`);
  return { id: result.data.id, updated: false };
};

module.exports = sizeGateComment;
