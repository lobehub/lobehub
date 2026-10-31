import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGithubStore } from './desktopReleaseGithub.mjs';
import {
  formatIntent,
  parseIntent,
  requestFromPr,
  validatePrIntent,
  validateReleaseIntent,
} from './desktopReleaseIntent.mjs';
import { recordPublication, sourcesHash, stablePlatforms } from './desktopReleaseSources.mjs';
import {
  fixtureCloud,
  fixtureNextOss,
  fixtureOss,
  fixtureSources,
  startGithubFixture,
} from './desktopReleaseTestUtils.mjs';

const hotfix = {
  schemaVersion: 1,
  mode: 'hotfix',
  baseVersion: '2.2.21',
  cloudSha: fixtureCloud,
  baseSourcesHash: sourcesHash(fixtureSources),
};
const pr = (overrides = {}) => ({
  number: 22000,
  title: '🐛 fix: a targeted repair',
  body: formatIntent(hotfix),
  head: { ref: 'hotfix/a-repair' },
  base: { ref: 'main', sha: fixtureOss },
  ...overrides,
});

async function delivered(t) {
  const github = await startGithubFixture();
  t.after(github.close);
  const store = createGithubStore(github.options);
  await store.createSources('2.2.21', fixtureSources);
  await recordPublication(
    {
      version: '2.2.21',
      sourcesHash: sourcesHash(fixtureSources),
      runId: '40841847688',
      publishedAt: '2026-10-31T12:00:00Z',
      platforms: stablePlatforms,
      outcomes: { build: 'success', github: 'success', s3: 'success', sparkle: 'success' },
    },
    store,
  );
  return { github, store };
}

test('weekly releases select ordinary initialization but targeted patches need explicit metadata', () => {
  assert.equal(
    requestFromPr(pr({ head: { ref: 'release/weekly-20261031' }, body: '' })).mode,
    'initialize',
  );
  assert.equal(
    requestFromPr(
      pr({ title: '🔨 chore: repair tooling', head: { ref: 'chore/tools' }, body: '' }),
    ),
    null,
  );
  assert.throws(() => requestFromPr(pr({ body: '' })), /metadata|base|intent/i);
  assert.throws(
    () => requestFromPr(pr({ body: formatIntent({ schemaVersion: 1, mode: 'initialize' }) })),
    /weekly|ordinary|hotfix/i,
  );
});

test('a PR keeps the exact chosen hotfix baseline and rejects duplicate metadata', () => {
  assert.deepEqual(requestFromPr(pr()), hotfix);
  assert.throws(
    () => parseIntent(`${formatIntent(hotfix)}\n${formatIntent(hotfix)}`),
    /duplicate|one/i,
  );
});

test('structured metadata safely round-trips a Cloud repair reason containing HTML delimiters', () => {
  const value = { ...hotfix, overrideReason: 'repair --> <script>example</script>' };
  assert.deepEqual(parseIntent(formatIntent(value)), value);
});

test('merged release metadata is bound to the actual target OSS commit', () => {
  const value = { ...hotfix, mergeSha: fixtureNextOss, prNumber: 22000, prBaseSha: fixtureOss };
  assert.deepEqual(validateReleaseIntent(formatIntent(value), fixtureNextOss), value);
  assert.throws(
    () => validateReleaseIntent(formatIntent(value), fixtureOss),
    /SHA|commit|mismatch/i,
  );
});

test('a hotfix PR validates the delivered record and cannot use an unpublished base', async (t) => {
  const { github, store } = await delivered(t);
  assert.deepEqual(await validatePrIntent(pr(), store), hotfix);
  github.releases.get('2.2.21').assets = github.releases
    .get('2.2.21')
    .assets.filter((asset) => asset.name !== 'desktop-published.v1.json');
  await assert.rejects(validatePrIntent(pr(), store), /published|delivered/i);
});

test('a changed hotfix baseline hash is rejected before merging', async (t) => {
  const { store } = await delivered(t);
  await assert.rejects(
    validatePrIntent(
      pr({ body: formatIntent({ ...hotfix, baseSourcesHash: '0'.repeat(64) }) }),
      store,
    ),
    /hash/i,
  );
});

test('a different Cloud SHA needs a recorded repair reason', async (t) => {
  const { store } = await delivered(t);
  const repair = { ...hotfix, cloudSha: '1'.repeat(40) };
  await assert.rejects(validatePrIntent(pr({ body: formatIntent(repair) }), store), /reason/i);
  assert.equal(
    (
      await validatePrIntent(
        pr({ body: formatIntent({ ...repair, overrideReason: 'Backport Cloud fix' }) }),
        store,
      )
    ).cloudSha,
    repair.cloudSha,
  );
});

test('main may advance with release tooling, but undistributed product changes block hotfix inheritance', async (t) => {
  const { github, store } = await delivered(t);
  const changed = pr({ base: { ref: 'main', sha: fixtureNextOss } });
  github.state.comparison = {
    status: 'ahead',
    total_commits: 1,
    files: [{ filename: '.github/scripts/desktopReleaseCli.mjs' }],
  };
  assert.equal((await validatePrIntent(changed, store)).baseVersion, '2.2.21');
  github.state.comparison.files = [{ filename: 'src/features/CanvasStorage/useCanvasStorage.ts' }];
  await assert.rejects(validatePrIntent(changed, store), /product changes|baseline/i);
});
