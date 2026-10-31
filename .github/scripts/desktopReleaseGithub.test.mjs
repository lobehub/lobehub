import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGithubStore } from './desktopReleaseGithub.mjs';
import { recordPublication, sourcesHash, stablePlatforms } from './desktopReleaseSources.mjs';
import {
  fixtureCloud,
  fixtureOss,
  fixtureSources,
  startGithubFixture,
} from './desktopReleaseTestUtils.mjs';

test('GitHub assets preserve the first source record without clobbering', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  const store = createGithubStore(github.options);
  assert.equal(await store.createSources('2.2.21', fixtureSources), true);
  assert.equal(
    await store.createSources('2.2.21', { ...fixtureSources, cloudSha: '0'.repeat(40) }),
    false,
  );
  assert.deepEqual(await store.readSources('2.2.21'), fixtureSources);
});

test('asset lookup follows pagination and reads JSON via its asset ID', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  for (let i = 0; i < 100; i++) github.addAsset('2.2.21', `other-${i}.txt`, 'unrelated');
  github.addAsset('2.2.21', 'desktop-sources.v1.json', JSON.stringify(fixtureSources));
  assert.deepEqual(await createGithubStore(github.options).readSources('2.2.21'), fixtureSources);
});

test('only a genuinely missing asset returns null; API failures and corrupt JSON reject', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  const store = createGithubStore(github.options);
  assert.equal(await store.readSources('2.2.21'), null);
  github.state.error = 403;
  await assert.rejects(store.readSources('2.2.21'), /403/);
  github.state.error = null;
  github.addAsset('2.2.21', 'desktop-sources.v1.json', '{broken');
  await assert.rejects(store.readSources('2.2.21'), /JSON|invalid/i);
});

test('a missing download after asset discovery fails rather than reinitializing', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  const asset = github.addAsset('2.2.21', 'desktop-sources.v1.json', '{}');
  github.assets.delete(asset.id);
  await assert.rejects(createGithubStore(github.options).readSources('2.2.21'), /404/);
});

test('commit resolution peels source tags and Cloud requests use their read token', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  const store = createGithubStore(github.options);
  assert.equal(await store.resolveCommit('v2.2.21'), fixtureOss);
  await store.assertCloudCommit(fixtureCloud);
  await assert.rejects(
    createGithubStore({ ...github.options, cloudToken: 'wrong' }).assertCloudCommit(fixtureCloud),
    /403/,
  );
});

test('historical evidence must identify the actual OSS run and attempt', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  const store = createGithubStore(github.options);
  await store.assertImportEvidence({ ossSha: fixtureOss, evidence: fixtureSources.evidence });
  await assert.rejects(
    store.assertImportEvidence({ ossSha: '0'.repeat(40), evidence: fixtureSources.evidence }),
    /evidence|mismatch/i,
  );
  await assert.rejects(
    store.assertImportEvidence({
      ossSha: fixtureOss,
      evidence: { ...fixtureSources.evidence, runAttempt: 3 },
    }),
    /attempt|evidence/i,
  );
});

test('baseline listing includes only releases with matching successful publication proof', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  const store = createGithubStore(github.options);
  await store.createSources('2.2.21', fixtureSources);
  assert.deepEqual(await store.listDelivered(), []);
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
  assert.deepEqual(await store.listDelivered(), [fixtureSources]);
});
