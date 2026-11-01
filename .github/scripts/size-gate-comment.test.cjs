const assert = require('node:assert/strict');
const { test } = require('node:test');

const sizeGateComment = require('./size-gate-comment.cjs');

const MARKER = '<!-- SIZE-GATE-REVIEW-web -->';

const REPORT = `### ✅ Web dist — 4 entries, largest Δ +7.0 KB (+0.00%)

| Entry | Baseline | Current | Δ | Result |
| --- | --- | --- | --- | --- |
| total | 146.75 MB | 146.76 MB | +7.0 KB (+0.00%) | ✅ |

### ✅ First-screen static import graph (gzip) — 2 entries, largest Δ +0.3 KB (+0.02%)

| Entry | Baseline | Current | Δ | Result |
| --- | --- | --- | --- | --- |
| dist/auth | 531.6 KB | 531.6 KB | +0.3 KB (+0.02%) | ✅ |`;

const fakeGithub = ({ comments = [], reviews = [] } = {}) => {
  const calls = [];
  const record =
    (name, data = {}) =>
    async (params) => {
      calls.push({ name, params });
      return { data };
    };
  return {
    calls,
    paginate: async (fn, params) => (await fn(params)).data,
    rest: {
      issues: {
        createComment: record('createComment', { id: 42 }),
        listComments: record('listComments', comments),
        updateComment: record('updateComment'),
      },
      pulls: {
        createReview: record('createReview', { id: 7 }),
        dismissReview: record('dismissReview'),
        listReviews: record('listReviews', reviews),
        updateReview: record('updateReview'),
      },
    },
  };
};

const run = (github, failed) =>
  sizeGateComment({
    context: { repo: { owner: 'o', repo: 'r' } },
    failed,
    github,
    identifier: 'web',
    issueNumber: 1,
    report: REPORT,
    title: 'Web dist',
  });

const bodyOf = (github, name) => github.calls.find((c) => c.name === name).params.body;

test('a failing gate requests changes once and links the report comment', async () => {
  const github = fakeGithub();
  await run(github, true);
  const review = github.calls.find((c) => c.name === 'createReview');
  assert.equal(review.params.event, 'REQUEST_CHANGES');
  assert.ok(review.params.body.includes(MARKER));
  assert.ok(review.params.body.includes('#issuecomment-42'));
});

test('a still-failing gate updates the open review instead of stacking another', async () => {
  const github = fakeGithub({
    reviews: [{ body: `${MARKER} old`, id: 9, state: 'CHANGES_REQUESTED' }],
  });
  await run(github, true);
  assert.equal(
    github.calls.some((c) => c.name === 'createReview'),
    false,
  );
  assert.equal(github.calls.find((c) => c.name === 'updateReview').params.review_id, 9);
});

test('a passing gate dismisses only its own open review', async () => {
  const github = fakeGithub({
    reviews: [
      { body: `${MARKER} old`, id: 9, state: 'CHANGES_REQUESTED' },
      { body: 'human review', id: 10, state: 'CHANGES_REQUESTED' },
      { body: `${MARKER} done`, id: 11, state: 'DISMISSED' },
    ],
  });
  await run(github, false);
  const dismissed = github.calls.filter((c) => c.name === 'dismissReview');
  assert.deepEqual(
    dismissed.map((c) => c.params.review_id),
    [9],
  );
  assert.equal(
    github.calls.some((c) => c.name === 'createReview'),
    false,
  );
});

test('a passing gate folds the report behind one summary line', async () => {
  const github = fakeGithub();
  await run(github, false);
  const body = bodyOf(github, 'createComment');

  assert.ok(body.startsWith('<!-- SIZE-GATE-COMMENT-web -->'));
  assert.equal(body.split('\n')[1], '<details>');
  assert.ok(body.trimEnd().endsWith('</details>'));

  const summary = body.split('\n').find((line) => line.startsWith('<summary>'));
  assert.equal(
    summary,
    '<summary>✅ Bundle Size Gate — Web dist · 2 checks passed — expand for the tables</summary>',
  );
  // A folded line carries no table of its own; every table sits below the fold.
  assert.ok(!summary.includes('|'));
  assert.equal(body.split('<summary>')[0].includes('|'), false);
  assert.ok(body.indexOf('| Entry |') > body.indexOf('</summary>'));
});

test('a failing gate keeps the report expanded instead of folding it', async () => {
  const github = fakeGithub();
  await run(github, true);
  const body = bodyOf(github, 'createComment');

  assert.ok(body.includes('### ❌ Bundle Size Gate — Web dist'));
  assert.equal(body.includes('<details>'), false);
  assert.ok(body.indexOf('| Entry |') > 0);
});

test('folding also applies when the existing comment is updated in place', async () => {
  const github = fakeGithub({
    comments: [{ body: '<!-- SIZE-GATE-COMMENT-web --> old report', id: 5 }],
  });
  await run(github, false);

  assert.equal(
    github.calls.some((c) => c.name === 'createComment'),
    false,
  );
  const update = github.calls.find((c) => c.name === 'updateComment');
  assert.equal(update.params.comment_id, 5);
  assert.ok(update.params.body.includes('<details>'));
  assert.ok(update.params.body.includes('| Entry |'));
});

test('a skipped gate folds into a single warning line', async () => {
  const github = fakeGithub();
  await sizeGateComment({
    context: { repo: { owner: 'o', repo: 'r' } },
    failed: false,
    github,
    identifier: 'web',
    issueNumber: 1,
    report:
      '### ⚠️ Web dist\n\nNo baseline found (`x.json`).\n\n> Gate skipped — no failure is reported.',
    title: 'Web dist',
  });

  assert.ok(
    bodyOf(github, 'createComment').includes(
      '<summary>⚠️ Bundle Size Gate — Web dist · 0 of 1 checks passed — expand for why</summary>',
    ),
  );
});

test('a report that never reached the gate folds to a warning line, not a pass', async () => {
  const github = fakeGithub();
  await sizeGateComment({
    context: { repo: { owner: 'o', repo: 'r' } },
    failed: false,
    github,
    identifier: 'web',
    issueNumber: 1,
    report: 'Build did not reach the size gate step.',
    title: 'Web dist',
  });

  const body = bodyOf(github, 'createComment');
  assert.ok(
    body.includes('<summary>⚠️ Bundle Size Gate — Web dist — expand for the details</summary>'),
  );
  assert.ok(body.includes('Build did not reach the size gate step.'));
});
