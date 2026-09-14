const assert = require('node:assert/strict');
const { test } = require('node:test');

const sizeGateComment = require('./size-gate-comment.cjs');

const MARKER = '<!-- SIZE-GATE-REVIEW-web -->';

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
    report: 'report',
    title: 'Web dist',
  });

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
