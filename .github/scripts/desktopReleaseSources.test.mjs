import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  recordPublication,
  resolveSources,
  sourcesHash,
  validateSources,
} from './desktopReleaseSources.mjs';

const ossSha = '483c4a343e437bf6e812b5f71a9a47ce7b5c7be4';
const cloudSha = 'bae4221819d5d3090a606610e6af3c28715749aa';
const nextCloud = '1df42564c5b35f21b24bcca164d71183b0619525';
const nextOss = '90659e0ed1327cd9bccb065d30b8edd09a8e9064';
const source = {
  schemaVersion: 1,
  channel: 'stable',
  version: '2.2.21',
  ossSha,
  cloudSha,
  selection: 'latest',
  baseVersion: null,
  evidence: { runId: '40841847688', runAttempt: 1 },
};
const outcomes = { build: 'success', github: 'success', s3: 'success', sparkle: 'success' };
const platforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

const memoryStore = () => {
  const sources = new Map();
  const publications = new Map();
  return {
    sources,
    publications,
    async readSources(version) {
      return sources.get(version) ?? null;
    },
    async createSources(version, record) {
      if (sources.has(version)) return false;
      sources.set(version, structuredClone(record));
      return true;
    },
    async readPublication(version) {
      return publications.get(version) ?? null;
    },
    async createPublication(version, receipt) {
      if (publications.has(version)) return false;
      publications.set(version, structuredClone(receipt));
      return true;
    },
  };
};
const request = (overrides = {}) => ({
  mode: 'initialize',
  version: '2.2.21',
  ossSha,
  evidence: { runId: '40841847688', runAttempt: 1 },
  firstRelease: true,
  write: true,
  ...overrides,
});
const dependencies = (store, overrides = {}) => ({
  store,
  latestCloud: async () => cloudSha,
  assertCloudCommit: async () => {},
  assertImportEvidence: async () => {},
  ...overrides,
});
const publish = (store, overrides = {}) =>
  recordPublication(
    {
      version: '2.2.21',
      sourcesHash: sourcesHash(source),
      runId: '40841847688',
      publishedAt: '2026-10-31T12:00:00.000Z',
      outcomes,
      platforms,
      ...overrides,
    },
    store,
  );

test('a rebuild uses the first Cloud after HEAD advances', async () => {
  const store = memoryStore();
  await resolveSources(request(), dependencies(store));
  const result = await resolveSources(
    request({ mode: 'rebuild', evidence: { runId: '40841847688', runAttempt: 3 } }),
    dependencies(store, { latestCloud: async () => nextCloud }),
  );
  assert.equal(result.sources.cloudSha, cloudSha);
  assert.equal(store.sources.get('2.2.21').evidence.runAttempt, 1);
});

test('a rerun cannot initialize a missing source lock', async () => {
  const store = memoryStore();
  await assert.rejects(
    resolveSources(
      request({ evidence: { runId: '40841847688', runAttempt: 2 } }),
      dependencies(store, { latestCloud: () => assert.fail('must not query HEAD') }),
    ),
    /initial|first|missing/i,
  );
  assert.equal(store.sources.size, 0);
});

test('a manual rebuild with no record fails without consulting HEAD', async () => {
  await assert.rejects(
    resolveSources(
      request({ mode: 'rebuild' }),
      dependencies(memoryStore(), { latestCloud: () => assert.fail('must not query HEAD') }),
    ),
    /missing/i,
  );
});

test('an existing lock rejects a different product SHA or Cloud override', async () => {
  const store = memoryStore();
  store.sources.set('2.2.21', source);
  for (const override of [{ ossSha: nextOss }, { cloudSha: nextCloud }]) {
    await assert.rejects(
      resolveSources(request({ mode: 'rebuild', ...override }), dependencies(store)),
      /conflict|mismatch/i,
    );
  }
  assert.deepEqual(store.sources.get('2.2.21'), source);
});

test('a corrupt or wrong-version source record never falls through to HEAD', async () => {
  for (const broken of [
    { ...source, cloudSha: 'main' },
    { ...source, version: '2.2.20' },
  ]) {
    const store = memoryStore();
    store.sources.set('2.2.21', broken);
    await assert.rejects(
      resolveSources(
        request(),
        dependencies(store, { latestCloud: () => assert.fail('must not query HEAD') }),
      ),
      /SHA|version|mismatch/i,
    );
  }
});

test('API failures propagate rather than being mistaken for a missing lock', async () => {
  const store = memoryStore();
  store.readSources = async () => {
    throw new Error('GitHub unavailable');
  };
  await assert.rejects(resolveSources(request(), dependencies(store)), /GitHub unavailable/);
});

test('a dry-run selects a candidate but does not persist a source record', async () => {
  const store = memoryStore();
  const result = await resolveSources(request({ write: false }), dependencies(store));
  assert.equal(result.sources.cloudSha, cloudSha);
  assert.equal(result.persisted, false);
  assert.equal(store.sources.size, 0);
});

test('a failed build leaves sources available but cannot become a hotfix baseline', async () => {
  const store = memoryStore();
  store.sources.set('2.2.21', source);
  assert.equal(await publish(store, { outcomes: { ...outcomes, build: 'failure' } }), null);
  assert.equal(store.sources.size, 1);
  await assert.rejects(
    resolveSources(
      request({ mode: 'hotfix', version: '2.2.22', ossSha: nextOss, baseVersion: '2.2.21' }),
      dependencies(store),
    ),
    /published|delivered/i,
  );
});

test('an OSS-only hotfix inherits the delivered baseline instead of latest Cloud', async () => {
  const store = memoryStore();
  store.sources.set('2.2.21', source);
  await publish(store);
  const result = await resolveSources(
    request({
      mode: 'hotfix',
      version: '2.2.22',
      ossSha: nextOss,
      baseVersion: 'v2.2.21',
      baseSourcesHash: sourcesHash(source),
    }),
    dependencies(store, { latestCloud: () => assert.fail('hotfix must not query HEAD') }),
  );
  assert.equal(result.sources.cloudSha, cloudSha);
  assert.equal(result.sources.ossSha, nextOss);
  assert.equal(result.sources.baseVersion, '2.2.21');
  assert.equal(result.sources.selection, 'inherit');
});

test('a hotfix refuses a changed baseline record or publication proof', async () => {
  const store = memoryStore();
  store.sources.set('2.2.21', source);
  await publish(store);
  store.sources.set('2.2.21', { ...source, cloudSha: nextCloud });
  await assert.rejects(
    resolveSources(
      request({
        mode: 'hotfix',
        version: '2.2.22',
        ossSha: nextOss,
        baseVersion: '2.2.21',
        baseSourcesHash: sourcesHash(source),
      }),
      dependencies(store),
    ),
    /hash|proof|mismatch/i,
  );
});

test('a hotfix Cloud repair needs a reason and is saved only on its new version', async () => {
  const store = memoryStore();
  store.sources.set('2.2.21', source);
  await publish(store);
  const input = request({
    mode: 'hotfix',
    version: '2.2.22',
    ossSha: nextOss,
    baseVersion: '2.2.21',
    cloudSha: nextCloud,
  });
  await assert.rejects(resolveSources(input, dependencies(store)), /reason/i);
  const result = await resolveSources(
    { ...input, overrideReason: 'Backport the Cloud fix' },
    dependencies(store),
  );
  assert.equal(result.sources.cloudSha, nextCloud);
  assert.equal(store.sources.get('2.2.21').cloudSha, cloudSha);
});

test('a historical import validates its run evidence before saving', async () => {
  const store = memoryStore();
  const input = request({ mode: 'import', cloudSha, firstRelease: false });
  await assert.rejects(
    resolveSources(
      input,
      dependencies(store, {
        assertImportEvidence: async () => {
          throw new Error('run SHA mismatch');
        },
      }),
    ),
    /run SHA mismatch/,
  );
  assert.equal(store.sources.size, 0);
  const result = await resolveSources(input, dependencies(store));
  assert.equal(result.sources.selection, 'historical-import');
  assert.equal(store.publications.size, 0);
});

test('a competing initializer cannot replace a different stored Cloud', async () => {
  const store = memoryStore();
  store.createSources = async () => {
    store.sources.set('2.2.21', { ...source, cloudSha: nextCloud });
    return false;
  };
  await assert.rejects(resolveSources(request(), dependencies(store)), /conflict/i);
  assert.equal(store.sources.get('2.2.21').cloudSha, nextCloud);
});

test('a competing initializer with identical sources reuses the winner', async () => {
  const store = memoryStore();
  store.createSources = async () => {
    store.sources.set('2.2.21', source);
    return false;
  };
  assert.deepEqual((await resolveSources(request(), dependencies(store))).sources, source);
});

test('partial, skipped or dry-run publication never creates delivery proof', async () => {
  for (const overrides of [
    { dryRun: true },
    { platforms: ['darwin-arm64'] },
    { outcomes: { ...outcomes, s3: 'skipped' } },
    { outcomes: { ...outcomes, sparkle: 'failure' } },
    { outcomes: { ...outcomes, github: 'cancelled' } },
  ]) {
    const store = memoryStore();
    store.sources.set('2.2.21', source);
    assert.equal(await publish(store, overrides), null);
    assert.equal(store.publications.size, 0);
  }
});

test('publication proof binds the exact source hash and is not overwritten by a rerun', async () => {
  const store = memoryStore();
  store.sources.set('2.2.21', source);
  await assert.rejects(publish(store, { sourcesHash: '0'.repeat(64) }), /hash|mismatch/i);
  const first = await publish(store);
  const second = await publish(store, { runId: 'later-run' });
  assert.equal(first.sourcesHash, sourcesHash(source));
  assert.deepEqual(first, second);
});

test('record hashes are stable across JSON property order and reject invalid identities', () => {
  assert.equal(
    sourcesHash({ ...source, version: '2.2.21' }),
    sourcesHash({ version: '2.2.21', ...source }),
  );
  assert.throws(() => validateSources({ ...source, channel: 'canary' }), /stable|channel/i);
  assert.throws(() => validateSources({ ...source, version: '2.2.22-canary.1' }), /version/i);
});
