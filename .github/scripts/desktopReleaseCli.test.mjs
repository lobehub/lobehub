import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createGithubStore } from './desktopReleaseGithub.mjs';
import { formatIntent, parseIntent } from './desktopReleaseIntent.mjs';
import { recordPublication, sourcesHash, stablePlatforms } from './desktopReleaseSources.mjs';
import {
  fixtureCloud,
  fixtureNextOss,
  fixtureOss,
  fixtureSources,
  startGithubFixture,
} from './desktopReleaseTestUtils.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('./desktopReleaseCli.mjs', import.meta.url));

async function fixture(t) {
  const github = await startGithubFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-release-cli-'));
  t.after(async () => {
    await github.close();
    await rm(root, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    GITHUB_REPOSITORY: 'example/lobehub',
    GITHUB_API_URL: github.apiUrl,
    GH_TOKEN: 'oss-test-token',
    CLOUD_REPOSITORY: 'example/cloud',
    CLOUD_TOKEN: 'cloud-test-token',
    RELEASE_VERSION: '2.2.21',
    RELEASE_MODE: 'rebuild',
    SOURCE_REF: 'v2.2.21',
    GITHUB_RUN_ID: '40841847688',
    GITHUB_RUN_ATTEMPT: '3',
    GITHUB_OUTPUT: path.join(root, 'outputs'),
    RUNNER_TEMP: root,
    WRITE_SOURCES: 'false',
  };
  return {
    github,
    root,
    env,
    run: (overrides = {}, command = 'resolve') =>
      exec(process.execPath, [cli, command], { env: { ...env, ...overrides }, cwd: root }),
  };
}

test('the real CLI rebuilds the old product ref with its saved Cloud', async (t) => {
  const { github, env, run } = await fixture(t);
  github.addAsset('2.2.21', 'desktop-sources.v1.json', JSON.stringify(fixtureSources));
  github.state.rejectHead = true;
  await run();
  const output = await readFile(env.GITHUB_OUTPUT, 'utf8');
  assert.match(output, new RegExp(`oss_sha=${fixtureOss}`));
  assert.match(output, new RegExp(`cloud_sha=${fixtureCloud}`));
  assert.match(output, /persisted=true/);
});

test('a missing lock makes the CLI fail without querying current Cloud HEAD', async (t) => {
  const { github, run } = await fixture(t);
  github.state.rejectHead = true;
  await assert.rejects(run(), (error) => /Missing source record/.test(error.stderr));
});

test('a version input cannot relabel latest main as an older source tag', async (t) => {
  const { github, run } = await fixture(t);
  github.addAsset('2.2.21', 'desktop-sources.v1.json', JSON.stringify(fixtureSources));
  await assert.rejects(run({ SOURCE_REF: 'main' }), (error) =>
    /source_ref|target tag/i.test(error.stderr),
  );
});

test('an explicit import records the original run but does not publish delivery proof', async (t) => {
  const { github, run } = await fixture(t);
  await run({
    RELEASE_MODE: 'import',
    CLOUD_REF: fixtureCloud,
    EVIDENCE_RUN_ID: '40841847688',
    EVIDENCE_RUN_ATTEMPT: '1',
    WRITE_SOURCES: 'true',
  });
  const names = github.releases.get('2.2.21').assets.map((asset) => asset.name);
  assert.deepEqual(names, ['desktop-sources.v1.json']);
  const asset = [...github.assets.values()].find((entry) => entry.name === names[0]);
  const record = JSON.parse(asset.content);
  assert.equal(record.selection, 'historical-import');
  assert.equal(record.evidence.runAttempt, 1);
});

test('a dry-run ordinary candidate does not add a Release asset', async (t) => {
  const { github, run } = await fixture(t);
  await run({ RELEASE_MODE: 'initialize', FIRST_RELEASE: 'true', GITHUB_RUN_ATTEMPT: '1' });
  assert.equal(github.releases.get('2.2.21').assets.length, 0);
});

test('prepare-release binds weekly intent once and automatic source resolution consumes it', async (t) => {
  const { github, root, run } = await fixture(t);
  const eventPath = path.join(root, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 22000,
        merged: true,
        title: '🚀 release: 20261031',
        body: 'Release notes',
        html_url: 'https://example.test/pull/22000',
        head: { ref: 'release/weekly-20261031' },
        base: { ref: 'main', sha: fixtureOss },
        merge_commit_sha: fixtureOss,
      },
    }),
  );
  await run({ GITHUB_EVENT_PATH: eventPath }, 'prepare-release');
  const body = await readFile(path.join(root, 'desktop-release-body.md'), 'utf8');
  assert.deepEqual(parseIntent(body), {
    schemaVersion: 1,
    mode: 'initialize',
    mergeSha: fixtureOss,
    prNumber: 22000,
  });
  await writeFile(eventPath, JSON.stringify({ action: 'published', release: { body } }));
  await run({
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'release',
    RELEASE_MODE: 'auto',
    WRITE_SOURCES: 'true',
    GITHUB_RUN_ATTEMPT: '1',
  });
  assert.equal(github.releases.get('2.2.21').assets.length, 1);
});

test('a release intent for a different merge cannot initialize sources', async (t) => {
  const { github, root, run } = await fixture(t);
  const eventPath = path.join(root, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({
      action: 'published',
      release: {
        body: formatIntent({
          schemaVersion: 1,
          mode: 'initialize',
          mergeSha: '1'.repeat(40),
          prNumber: 22000,
        }),
      },
    }),
  );
  await assert.rejects(
    run({
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: 'release',
      RELEASE_MODE: 'auto',
      WRITE_SOURCES: 'true',
      GITHUB_RUN_ATTEMPT: '1',
    }),
    (error) => /mismatch/.test(error.stderr),
  );
  assert.equal(github.releases.get('2.2.21').assets.length, 0);
});

test('successful jobs that skipped actual uploads cannot produce delivery proof', async (t) => {
  const { github, run } = await fixture(t);
  github.addAsset('2.2.21', 'desktop-sources.v1.json', JSON.stringify(fixtureSources));
  await run(
    {
      SOURCES_HASH: sourcesHash(fixtureSources),
      BUILT_PLATFORMS: JSON.stringify(stablePlatforms),
      PUBLICATION_OUTCOMES: JSON.stringify({
        build: 'success',
        github: 'success',
        s3: 'success',
        sparkle: 'success',
      }),
      CORE_PUBLISHED: 'false',
      INSTALLERS_PUBLISHED: 'true',
      SPARKLE_PUBLISHED: 'true',
    },
    'publish',
  );
  assert.equal(
    github.releases
      .get('2.2.21')
      .assets.some((asset) => asset.name === 'desktop-published.v1.json'),
    false,
  );
});

test('delivery proof requires public installer assets as well as completed upload stages', async (t) => {
  const { github, run } = await fixture(t);
  github.addAsset('2.2.21', 'desktop-sources.v1.json', JSON.stringify(fixtureSources));
  const env = {
    SOURCES_HASH: sourcesHash(fixtureSources),
    BUILT_PLATFORMS: JSON.stringify(stablePlatforms),
    PUBLICATION_OUTCOMES: JSON.stringify({
      build: 'success',
      github: 'success',
      s3: 'success',
      sparkle: 'success',
    }),
    CORE_PUBLISHED: 'true',
    INSTALLERS_PUBLISHED: 'true',
    SPARKLE_PUBLISHED: 'true',
  };
  await assert.rejects(run(env, 'publish'), (error) => /installer|asset/i.test(error.stderr));
  for (const name of [
    'latest.yml',
    'latest-linux.yml',
    'latest-mac-arm64.yml',
    'latest-mac-x64.yml',
    'LobeHub-2.2.21-arm64.dmg',
    'LobeHub-2.2.21-x64.dmg',
    'LobeHub-2.2.21-setup.exe',
    'LobeHub-2.2.21.AppImage',
  ])
    github.addAsset('2.2.21', name, 'fixture bytes');
  await run(env, 'publish');
  assert.equal(
    github.releases
      .get('2.2.21')
      .assets.some((asset) => asset.name === 'desktop-published.v1.json'),
    true,
  );
});

test('operators can generate pinned hotfix metadata for an existing manually created PR', async (t) => {
  const { github, run } = await fixture(t);
  const store = createGithubStore(github.options);
  await store.createSources('2.2.21', fixtureSources);
  await assert.rejects(run({ BASE_VERSION: '2.2.21' }, 'hotfix-intent'));
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
  const result = await run({ BASE_VERSION: '2.2.21' }, 'hotfix-intent');
  const intent = parseIntent(result.stdout);
  assert.equal(intent.mode, 'hotfix');
  assert.equal(intent.cloudSha, fixtureCloud);
  assert.equal(intent.baseSourcesHash, sourcesHash(fixtureSources));
});

async function hotfixFixture(t) {
  const context = await fixture(t);
  const { github, root } = context;
  const store = createGithubStore(github.options);
  github.parents.set(fixtureNextOss, [fixtureCloud]);
  github.commits.set('main', fixtureCloud);
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
  const intent = {
    schemaVersion: 1,
    mode: 'hotfix',
    baseVersion: '2.2.21',
    cloudSha: fixtureCloud,
    baseSourcesHash: sourcesHash(fixtureSources),
    mergeSha: fixtureNextOss,
    prNumber: 22000,
    prBaseSha: fixtureCloud,
  };
  // Raw transport, so the test does not depend on the production formatter preserving the base SHA.
  const body = `<!-- desktop-release-request ${JSON.stringify(intent)} -->`;
  github.releases.get('2.2.22').body = body;
  github.state.pullRequest = {
    number: 22000,
    merged: true,
    merge_commit_sha: fixtureNextOss,
    base: { ref: 'main', sha: fixtureCloud },
  };
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({ action: 'published', release: { body } }));
  const input = {
    RELEASE_VERSION: '2.2.22',
    SOURCE_REF: 'v2.2.22',
    BASE_VERSION: '2.2.21',
    WRITE_SOURCES: 'true',
    GITHUB_RUN_ATTEMPT: '1',
  };
  return { ...context, input, eventPath };
}

test('manual hotfix rejects undelivered product changes in the actual merged PR base', async (t) => {
  const { github, input, run } = await hotfixFixture(t);
  github.state.comparison = {
    status: 'ahead',
    total_commits: 1,
    files: [{ filename: 'src/features/CanvasStorage/useCanvasStorage.ts' }],
  };
  await assert.rejects(run({ ...input, RELEASE_MODE: 'hotfix' }), (error) =>
    /product changes|baseline/i.test(error.stderr),
  );
  assert.equal(github.releases.get('2.2.22').assets.length, 0);
  github.state.comparison.files = [{ filename: '.github/workflows/release-desktop-stable.yml' }];
  await run({ ...input, RELEASE_MODE: 'hotfix' });
  assert.equal(github.releases.get('2.2.22').assets.length, 1);
});

test('manual hotfix cannot invent a PR identity or change a bound baseline', async (t) => {
  const { github, input, run } = await hotfixFixture(t);
  github.state.pullRequest.merge_commit_sha = fixtureOss;
  await assert.rejects(run({ ...input, RELEASE_MODE: 'hotfix' }), (error) =>
    /PR|identity|merge/i.test(error.stderr),
  );
  github.state.pullRequest.merge_commit_sha = fixtureNextOss;
  github.parents.set(fixtureNextOss, [fixtureOss]);
  await assert.rejects(run({ ...input, RELEASE_MODE: 'hotfix' }), (error) =>
    /PR|identity|base/i.test(error.stderr),
  );
  github.parents.set(fixtureNextOss, [fixtureCloud]);
  github.state.comparison = { status: 'ahead', total_commits: 1, files: [] };
  await assert.rejects(run({ ...input, RELEASE_MODE: 'hotfix', BASE_VERSION: '2.2.20' }), (error) =>
    /conflict|mismatch/i.test(error.stderr),
  );
  github.releases.get('2.2.22').body = '';
  await assert.rejects(run({ ...input, RELEASE_MODE: 'hotfix' }), (error) =>
    /intent|metadata/i.test(error.stderr),
  );
  assert.equal(github.releases.get('2.2.22').assets.length, 0);
});

test('prepare-release binds the validated hotfix request to its actual PR base', async (t) => {
  const { github, root, run, eventPath } = await hotfixFixture(t);
  const bound = parseIntent(github.releases.get('2.2.22').body);
  const { mergeSha, prNumber, prBaseSha, ...request } = bound;
  github.state.comparison = { status: 'ahead', total_commits: 1, files: [] };
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        ...github.state.pullRequest,
        title: '🐛 fix: targeted repair',
        head: { ref: 'hotfix/a-repair' },
        html_url: 'https://example.test/pull/22000',
        body: formatIntent(request),
      },
    }),
  );
  await run({ GITHUB_EVENT_PATH: eventPath, RELEASE_VERSION: '2.2.22' }, 'prepare-release');
  const body = await readFile(path.join(root, 'desktop-release-body.md'), 'utf8');
  assert.equal(parseIntent(body).mergeSha, mergeSha);
  assert.equal(parseIntent(body).prNumber, prNumber);
  assert.equal(parseIntent(body).prBaseSha, prBaseSha);
});

test('automatic hotfix reruns cannot initialize missing locks but can reuse the first attempt', async (t) => {
  const { github, input, eventPath, run } = await hotfixFixture(t);
  github.state.comparison = { status: 'ahead', total_commits: 1, files: [] };
  const automatic = {
    ...input,
    RELEASE_MODE: 'auto',
    GITHUB_EVENT_NAME: 'release',
    GITHUB_EVENT_PATH: eventPath,
  };
  await assert.rejects(run({ ...automatic, GITHUB_RUN_ATTEMPT: '2' }), (error) =>
    /missing|initial|first|import/i.test(error.stderr),
  );
  assert.equal(github.releases.get('2.2.22').assets.length, 0);
  await run(automatic);
  await run({ ...automatic, GITHUB_RUN_ATTEMPT: '2' });
  assert.equal(github.releases.get('2.2.22').assets.length, 1);
});

async function recoveryFixture(t) {
  const context = await fixture(t);
  const { github, root } = context;
  github.commits.set('main', fixtureOss);
  const request = {
    schemaVersion: 1,
    mode: 'recovery',
    recoveryBaseSha: fixtureOss,
    cloudSha: fixtureCloud,
    overrideReason: 'Publish the pending main hotfix with its verified Cloud revision',
  };
  const bound = { ...request, mergeSha: fixtureNextOss, prNumber: 22001, prBaseSha: fixtureOss };
  const rawIntent = (value) => `<!-- desktop-release-request ${JSON.stringify(value)} -->`;
  const pr = {
    number: 22001,
    merged: true,
    merge_commit_sha: fixtureNextOss,
    title: '🐛 fix(chat): pending main hotfix',
    head: { ref: 'hotfix/message-send-scroll' },
    base: { ref: 'main', sha: fixtureOss },
    html_url: 'https://example.test/pull/22001',
    body: rawIntent(request),
  };
  github.state.pullRequest = pr;
  github.state.rejectHead = true;
  const eventPath = path.join(root, 'recovery-event.json');
  const setIntent = async (intent) => {
    const body = rawIntent(intent);
    github.releases.get('2.2.22').body = body;
    await writeFile(eventPath, JSON.stringify({ action: 'published', release: { body } }));
  };
  await setIntent(bound);
  const input = {
    RELEASE_VERSION: '2.2.22',
    SOURCE_REF: 'v2.2.22',
    RELEASE_MODE: 'auto',
    GITHUB_EVENT_NAME: 'release',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_RUN_ATTEMPT: '1',
    WRITE_SOURCES: 'true',
  };
  return { ...context, input, request, bound, pr, eventPath, setIntent };
}

test('explicit recovery pins a new release without inventing a delivered baseline', async (t) => {
  const { github, input, run, request } = await recoveryFixture(t);
  await run(input);
  const names = github.releases.get('2.2.22').assets.map((asset) => asset.name);
  assert.deepEqual(names, ['desktop-sources.v1.json']);
  const saved = JSON.parse(
    [...github.assets.values()].find((asset) => asset.name === names[0]).content,
  );
  assert.equal(saved.version, '2.2.22');
  assert.equal(saved.ossSha, fixtureNextOss);
  assert.equal(saved.cloudSha, fixtureCloud);
  assert.equal(saved.selection, 'recovery');
  assert.equal(saved.baseVersion, null);
  assert.equal(saved.recoveryBaseSha, fixtureOss);
  assert.equal(saved.overrideReason, request.overrideReason);
  assert.equal(github.releases.get('2.2.21').assets.length, 0);
});

test('recovery PR validation freezes the actual main base before binding its merge identity', async (t) => {
  const { github, input, run, pr, eventPath, root } = await recoveryFixture(t);
  await writeFile(eventPath, JSON.stringify({ pull_request: pr }));
  await run(input, 'check-pr');
  await run(input, 'prepare-release');
  const intent = parseIntent(await readFile(path.join(root, 'desktop-release-body.md'), 'utf8'));
  assert.equal(intent.mode, 'recovery');
  assert.equal(intent.mergeSha, fixtureNextOss);
  assert.equal(intent.recoveryBaseSha, fixtureOss);
  assert.equal(intent.prBaseSha, fixtureOss);
  github.parents.set(fixtureNextOss, [fixtureCloud]);
  await writeFile(eventPath, JSON.stringify({ pull_request: pr }));
  await assert.rejects(run(input, 'check-pr'), (error) => /base|recovery/i.test(error.stderr));
});

test('recovery cannot change or invent the merged PR base', async (t) => {
  const { github, input, run, bound, setIntent } = await recoveryFixture(t);
  github.parents.set(fixtureNextOss, [fixtureCloud]);
  await assert.rejects(run(input), (error) => /PR|base/i.test(error.stderr));
  github.parents.set(fixtureNextOss, [fixtureOss]);
  await setIntent({ ...bound, recoveryBaseSha: fixtureCloud });
  await assert.rejects(run(input), (error) => /base|recovery/i.test(error.stderr));
  assert.equal(github.releases.get('2.2.22').assets.length, 0);
});

test('recovery requires a reason and cannot initialize missing records on a rerun', async (t) => {
  const { github, input, run, bound, setIntent } = await recoveryFixture(t);
  await setIntent({ ...bound, overrideReason: '' });
  await assert.rejects(run(input), (error) => /reason/i.test(error.stderr));
  await setIntent(bound);
  await assert.rejects(run({ ...input, GITHUB_RUN_ATTEMPT: '2' }), (error) =>
    /missing|first|import/i.test(error.stderr),
  );
  assert.equal(github.releases.get('2.2.22').assets.length, 0);
  await run(input);
  await run({ ...input, RELEASE_MODE: 'rebuild', GITHUB_RUN_ATTEMPT: '2' });
  assert.equal(github.releases.get('2.2.22').assets.length, 1);
});

test('manual recovery resumes bound intent and rejects conflicting explicit inputs', async (t) => {
  const { github, input, run } = await recoveryFixture(t);
  const manual = { ...input, RELEASE_MODE: 'recovery' };
  await assert.rejects(run({ ...manual, CLOUD_REF: fixtureOss }), (error) =>
    /conflict/i.test(error.stderr),
  );
  await assert.rejects(run({ ...manual, CLOUD_OVERRIDE_REASON: 'Changed choice' }), (error) =>
    /conflict/i.test(error.stderr),
  );
  await run(manual);
  assert.equal(github.releases.get('2.2.22').assets.length, 1);
});

test('an open recovery checks live main even when the PR base snapshot is unchanged', async (t) => {
  const { github, input, run, pr, eventPath } = await recoveryFixture(t);
  github.commits.set('main', fixtureNextOss);
  await writeFile(eventPath, JSON.stringify({ pull_request: { ...pr, merged: false } }));
  await assert.rejects(run(input, 'check-pr'), (error) => /base|main|recovery/i.test(error.stderr));
});

test('recovery preparation rejects a changed merge parent hidden by the PR base snapshot', async (t) => {
  const { github, input, run, pr, eventPath } = await recoveryFixture(t);
  github.parents.set(fixtureNextOss, [fixtureCloud, fixtureOss]);
  await writeFile(eventPath, JSON.stringify({ pull_request: pr }));
  await assert.rejects(run(input, 'prepare-release'), (error) =>
    /base|recovery/i.test(error.stderr),
  );
});

test('Stable rejects recovery metadata whose base differs from the actual merge parent', async (t) => {
  const { github, input, run } = await recoveryFixture(t);
  github.parents.set(fixtureNextOss, [fixtureCloud, fixtureOss]);
  await assert.rejects(run(input), (error) => /base|PR|parent/i.test(error.stderr));
  assert.equal(github.releases.get('2.2.22').assets.length, 0);
});

test('hotfix binding uses the actual merge parent rather than a stale PR base snapshot', async (t) => {
  const { github, input, run, root, eventPath } = await hotfixFixture(t);
  const request = parseIntent(github.releases.get('2.2.22').body);
  delete request.mergeSha;
  delete request.prNumber;
  delete request.prBaseSha;
  github.parents.set(fixtureNextOss, [fixtureCloud, fixtureOss]);
  github.state.pullRequest.base.sha = fixtureOss;
  github.state.comparison = { status: 'ahead', total_commits: 1, files: [] };
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        ...github.state.pullRequest,
        title: '🐛 fix: targeted repair',
        head: { ref: 'hotfix/a-repair' },
        body: formatIntent(request),
      },
    }),
  );
  await run({ ...input, GITHUB_EVENT_PATH: eventPath }, 'prepare-release');
  const intent = parseIntent(await readFile(path.join(root, 'desktop-release-body.md'), 'utf8'));
  assert.equal(intent.prBaseSha, fixtureCloud);
  await run({ ...input, RELEASE_MODE: 'hotfix' });
});

test('prepare-release does not bind an unmerged PR to its temporary test merge', async (t) => {
  const { input, run, pr, eventPath } = await recoveryFixture(t);
  await writeFile(eventPath, JSON.stringify({ pull_request: { ...pr, merged: false } }));
  await assert.rejects(run(input, 'prepare-release'), (error) => /merged/i.test(error.stderr));
});

test('operators can generate explicit recovery metadata with a frozen base and reason', async (t) => {
  const { run, request } = await recoveryFixture(t);
  const env = {
    RECOVERY_BASE_SHA: fixtureOss,
    CLOUD_REF: fixtureCloud,
    CLOUD_OVERRIDE_REASON: request.overrideReason,
  };
  const result = await run(env, 'recovery-intent');
  assert.deepEqual(parseIntent(result.stdout), request);
  await assert.rejects(run({ ...env, CLOUD_OVERRIDE_REASON: '' }, 'recovery-intent'), (error) =>
    /reason/i.test(error.stderr),
  );
});
