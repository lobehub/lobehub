const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  LABEL,
  MARKER,
  closeIncomplete,
  findProblems,
  isExempt,
  run,
} = require('./pr-admission-check.cjs');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../PULL_REQUEST_TEMPLATE.md'), 'utf8');

/** The real template with Acceptance filled in, so template drift breaks these tests. */
const fill = (acceptance = 'https://app.lobehub.com/acceptance/abc') =>
  TEMPLATE.replace('- Acceptance: ...', `- Acceptance: ${acceptance}`);

const passes = (body) => findProblems({ body }).length === 0;

test('accepts the template with acceptance evidence', () => {
  assert.equal(passes(fill()), true);
});

test('flags the untouched template and an empty body', () => {
  assert.equal(passes(TEMPLATE), false);
  assert.equal(passes(null), false);
  assert.equal(passes(''), false);
});

test('ignores evidence that only appears inside HTML comments', () => {
  assert.equal(passes(fill('<!-- https://example.com/after.png -->')), false);
  // GitHub hides everything after an unclosed comment, so that text is not evidence either.
  assert.equal(passes(fill('<!-- https://example.com/after.png')), false);
  assert.equal(passes(fill('<!<!---- --> https://example.com/after.png')), true);
});

test('requires a reason when acceptance is opted out', () => {
  for (const acceptance of ['N/A', 'none', 'Not needed:', '`...`', '**TBD**']) {
    assert.equal(passes(fill(acceptance)), false, acceptance);
  }
  assert.equal(passes(fill('Not needed: CI config only')), true);
});

test('accepts acceptance evidence on the following lines', () => {
  assert.equal(passes(fill('\n  - ![after](https://example.com/after.png)')), true);
});

test('accepts free-form evidence sections maintainers write instead of the template', () => {
  assert.equal(
    passes('## What\n\nStuff.\n\n## Acceptance\n\nCI trigger only, no product change.'),
    true,
  );
  assert.equal(passes('### Verification\n\n- `bun run check` passes\n\n### Notes\n'), true);
  assert.equal(passes('## Test plan\n- open the page and click save'), true);
  assert.equal(passes('**Acceptance:** https://app.lobehub.com/acceptance/abc'), true);
});

test('accepts Chinese headings, test sections, and acceptance links anywhere', () => {
  assert.equal(passes('## 验收\n\n页面刷新后排序正确'), true);
  assert.equal(passes('## 测试\n\n- 新增单测覆盖回退分支'), true);
  assert.equal(passes('## Tests\n\n- added a regression test'), true);
  assert.equal(passes('See https://lobehub.com/acceptance/1b0501e6-11f4 for the round.'), true);
  assert.equal(
    passes(
      TEMPLATE.replace('- [ ] Tested locally', '- [x] Verified pricing against the model card'),
    ),
    true,
  );
});

test('keeps nested subheadings inside an evidence section', () => {
  assert.equal(
    passes(
      '## Acceptance\n### Local browser\n- Saved settings; refresh kept the value.\n## Notes\n',
    ),
    true,
  );
});

test('rejects sections made only of placeholder lines', () => {
  assert.equal(passes('## Acceptance\n### Local browser\n- TODO\n- TBD\n'), false);
  assert.equal(passes('## Acceptance\n### Local browser\n### Desktop\n'), false);
  assert.equal(passes('## Verification\n- TODO\n- TBD\n\n## Notes\nsomething'), false);
  assert.equal(passes('## Acceptance\n...\n...\n'), false);
});

test('rejects evidence sections that hold only scaffolding', () => {
  assert.equal(passes(TEMPLATE.replace('- [ ] Tested locally', '- [x] Tested locally')), false);
  assert.equal(passes('## Verification\n\n- [ ] Tested locally\n\n## Notes\nsomething'), false);
  assert.equal(passes('## Acceptance\n\nN/A\n\n## Notes\nsomething'), false);
});

test('exempts drafts, bots, team members, and release PRs', () => {
  const base = {
    draft: false,
    head: { ref: 'feat/x' },
    title: '🐛 fix: x',
    user: { login: 'someone' },
  };
  assert.equal(isExempt(base), false);
  assert.equal(isExempt({ ...base, author_association: 'FIRST_TIME_CONTRIBUTOR' }), false);
  assert.equal(isExempt({ ...base, author_association: 'CONTRIBUTOR' }), false);
  assert.equal(isExempt({ ...base, author_association: 'MEMBER' }), true);
  assert.equal(isExempt({ ...base, author_association: 'OWNER' }), true);
  // Private org members arrive as CONTRIBUTOR; the maintainer list still recognizes them.
  assert.equal(
    isExempt({ ...base, author_association: 'CONTRIBUTOR', user: { login: 'TJX666' } }),
    true,
  );
  assert.equal(isExempt({ ...base, title: '🚀 release: 20261007' }), true);
  assert.equal(isExempt({ ...base, title: '🚀 release: sync main branch to canary' }), true);
  assert.equal(isExempt({ ...base, head: { ref: 'release/db-migration-0152-forward' } }), true);
  assert.equal(isExempt({ ...base, draft: true }), true);
  assert.equal(isExempt({ ...base, user: { login: 'renovate[bot]', type: 'Bot' } }), true);
  assert.equal(isExempt({ ...base, user: { login: 'lobehubbot', type: 'User' } }), true);
  assert.equal(isExempt({ ...base, title: '🚀 release: v2.1.0' }), true);
  assert.equal(isExempt({ ...base, head: { ref: 'hotfix/v2.1.1' } }), true);
});

const fakeGithub = ({ comments = [], pulls = {} } = {}) => {
  const calls = [];
  const queries = [];
  const record = (name) => async (params) => {
    calls.push([name, params]);
    return {};
  };
  return {
    calls,
    paginate: async (method, params) => {
      queries.push(params);
      return comments;
    },
    queries,
    rest: {
      pulls: {
        get: async ({ pull_number }) => ({ data: pulls[pull_number] }),
        update: record('pullsUpdate'),
      },
      search: { issuesAndPullRequests: record('search') },
      issues: {
        addLabels: record('addLabels'),
        createComment: record('createComment'),
        deleteComment: record('deleteComment'),
        listComments: record('listComments'),
        removeLabel: record('removeLabel'),
        updateComment: record('updateComment'),
      },
    },
  };
};

const contextFor = (pr) => ({
  payload: {
    pull_request: {
      draft: false,
      head: { ref: 'feat/x' },
      labels: [],
      number: 7,
      title: '🐛 fix: x',
      user: { login: 'someone', type: 'User' },
      ...pr,
    },
  },
  repo: { owner: 'lobehub', repo: 'lobehub' },
});

const callNames = (github) => github.calls.map(([name]) => name);

test('labels and comments on an incomplete PR', async () => {
  const github = fakeGithub();
  await run({ context: contextFor({ body: TEMPLATE }), github });
  assert.deepEqual(callNames(github), ['addLabels', 'createComment']);
  assert.deepEqual(github.calls[0][1].labels, [LABEL]);
  assert.ok(github.calls[1][1].body.startsWith(MARKER));
});

test('updates the existing comment instead of posting another', async () => {
  const github = fakeGithub({ comments: [{ body: `${MARKER}\nold`, id: 42 }] });
  await run({ context: contextFor({ body: TEMPLATE, labels: [{ name: LABEL }] }), github });
  assert.deepEqual(callNames(github), ['updateComment']);
  assert.equal(github.calls[0][1].comment_id, 42);
});

test('writes nothing when the label and comment are already current', async () => {
  const first = fakeGithub();
  await run({ context: contextFor({ body: TEMPLATE }), github: first });
  const body = first.calls[1][1].body;

  const github = fakeGithub({ comments: [{ body, id: 42 }] });
  await run({ context: contextFor({ body: TEMPLATE, labels: [{ name: LABEL }] }), github });
  assert.deepEqual(callNames(github), []);
});

test('clears the label and comment once the PR is complete', async () => {
  const github = fakeGithub({ comments: [{ body: `${MARKER}\nold`, id: 42 }] });
  await run({ context: contextFor({ body: fill(), labels: [{ name: LABEL }] }), github });
  assert.deepEqual(callNames(github), ['removeLabel', 'deleteComment']);
});

test('does nothing for exempt PRs', async () => {
  const github = fakeGithub();
  await run({ context: contextFor({ body: TEMPLATE, draft: true }), github });
  assert.deepEqual(github.calls, []);
});

const NOW = new Date('2026-10-20T00:00:00Z');

/** A PR that still qualifies for closing at NOW. */
const candidate = (number, overrides = {}) => ({
  body: TEMPLATE,
  draft: false,
  head: { ref: 'feat/x' },
  labels: [{ name: LABEL }],
  number,
  state: 'open',
  title: '🐛 fix: x',
  updated_at: '2026-09-01T00:00:00Z',
  user: { login: 'someone', type: 'User' },
  ...overrides,
});

const closeWith = (github, dryRun) =>
  closeIncomplete({
    context: contextFor({}),
    core: { info: () => {} },
    dryRun,
    github,
    now: NOW,
  });

test('closeIncomplete only reports candidates in dry-run mode', async () => {
  const github = fakeGithub({
    comments: [{ number: 11 }, { number: 12 }],
    pulls: { 11: candidate(11), 12: candidate(12) },
  });
  assert.deepEqual(await closeWith(github, true), [11, 12]);
  assert.deepEqual(callNames(github), []);

  const { q } = github.queries[0];
  assert.match(q, /label:"pr:incomplete"/);
  assert.match(q, /-label:"keep-open"/);
  assert.match(q, /-is:draft/);
  assert.match(q, /updated:<2026-10-06/);
});

test('closeIncomplete comments and closes candidates', async () => {
  const github = fakeGithub({ comments: [{ number: 11 }], pulls: { 11: candidate(11) } });
  assert.deepEqual(await closeWith(github, false), [11]);
  assert.deepEqual(callNames(github), ['createComment', 'pullsUpdate']);
  assert.equal(github.calls.at(-1)[1].state, 'closed');
  assert.equal(github.calls.at(-1)[1].pull_number, 11);
});

test('closeIncomplete skips PRs that changed after the search', async () => {
  const changed = {
    21: candidate(21, { draft: true }),
    22: candidate(22, { labels: [{ name: LABEL }, { name: 'keep-open' }] }),
    23: candidate(23, { updated_at: '2026-10-19T00:00:00Z' }),
    24: candidate(24, { body: fill() }),
    25: candidate(25, { labels: [] }),
    26: candidate(26, { state: 'closed' }),
  };
  const github = fakeGithub({
    comments: Object.keys(changed).map((number) => ({ number: Number(number) })),
    pulls: changed,
  });
  assert.deepEqual(await closeWith(github, false), []);
  assert.deepEqual(callNames(github), []);
});
