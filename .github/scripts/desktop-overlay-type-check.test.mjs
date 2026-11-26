import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const load = async (path) => parse(await readFile(new URL(path, import.meta.url), 'utf8'));

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** CI only checks out tracked files, so a gitignored file hashes to nothing there. */
const isIgnored = (file) => {
  try {
    execFileSync('git', ['check-ignore', '--quiet', file], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
};

const needsOf = (job) => [job.needs ?? []].flat();

const stepUsing = (job, action) => job.steps.find((step) => step.uses === action);

const typeCheckStep = (job) => stepUsing(job, './.github/actions/overlay-type-check');

const sourceSteps = (job) =>
  job.steps.slice(0, job.steps.indexOf(stepUsing(job, './.github/actions/overlay-token')));

test('core OTA cannot publish before the overlaid sources type-check', async () => {
  const { jobs } = await load('../workflows/release-desktop-core-ota.yml');

  assert.ok(needsOf(jobs.publish).includes('overlay-type-check'));
  assert.doesNotMatch(String(jobs.publish.if), /always\(\)|cancelled\(\)|failure\(\)/);
});

test('core OTA type-checks the overlay revision it builds', async () => {
  const { jobs } = await load('../workflows/release-desktop-core-ota.yml');
  const built = stepUsing(jobs['build-core'], './.github/actions/desktop-build-setup');

  assert.equal(
    typeCheckStep(jobs['overlay-type-check']).with['overlay-ref'],
    built.with['cloud-ref'],
  );
});

for (const channel of ['canary', 'beta', 'stable']) {
  const loadJobs = async () => (await load(`../workflows/release-desktop-${channel}.yml`)).jobs;

  test(`a full ${channel} release cannot build before the overlaid sources type-check`, async () => {
    const jobs = await loadJobs();

    assert.ok(needsOf(jobs.build).includes('overlay-type-check'));
    assert.doesNotMatch(String(jobs.build.if), /always\(\)|failure\(\)/);
  });

  test(`a full ${channel} release type-checks the sources it builds`, async () => {
    const jobs = await loadJobs();
    const built = stepUsing(jobs.build, './.github/actions/desktop-build-setup');

    assert.equal(
      typeCheckStep(jobs['overlay-type-check']).with['overlay-ref'],
      built.with['cloud-ref'],
    );
    assert.deepEqual(sourceSteps(jobs['overlay-type-check']), sourceSteps(jobs.build));
  });
}

test('the type check runs from the overlay root against the pinned overlay revision', async () => {
  const { runs } = await load('../actions/overlay-type-check/action.yml');
  const overlay = stepUsing(runs, './.github/actions/business-overlay');
  const check = runs.steps.at(-1);

  assert.equal(overlay.with['overlay-ref'], '${{ inputs.overlay-ref }}');
  assert.ok(runs.steps.indexOf(overlay) < runs.steps.indexOf(check));
  assert.match(check.run, /cd \.\.[\s\S]*bun run type-check/);
});

test('a pull request is judged against its base under the same overlay revision', async () => {
  const { jobs } = await load('../workflows/pr-build-desktop.yml');
  const { steps } = jobs['overlay-type-check'];
  const [head, base] = steps.filter((step) => step.uses === './.github/actions/overlay-type-check');

  assert.equal(head['continue-on-error'], true);
  assert.equal(base.with['overlay-ref'], '${{ env.OVERLAY_REF }}');
  assert.match(
    steps.at(-1).run,
    new RegExp(`overlayTypeErrors\\.mjs .*${base.with['log-name']}.*${head.with['log-name']}`),
  );
});

test('every pull request gets the overlay check, not only desktop builds', async () => {
  const workflow = await load('../workflows/pr-build-desktop.yml');
  const job = workflow.jobs['overlay-type-check'];

  // The desktop build jobs are gated behind `trigger:build-desktop`; the overlay
  // check must not inherit that gate or ordinary pull requests go unchecked.
  assert.doesNotMatch(String(job.if ?? ''), /trigger:build-desktop|release\//);
  assert.ok([workflow.on.pull_request.types].flat().includes('opened'));
});

for (const path of [
  '../actions/overlay-type-check/action.yml',
  '../actions/desktop-build-setup/action.yml',
]) {
  test(`${path} installs from a cached pnpm store`, async () => {
    const { runs } = await load(path);
    const cache = stepUsing(runs, 'actions/cache@v4');
    const install = runs.steps.find((step) =>
      /pnpm install --node-linker=hoisted/.test(step.run ?? ''),
    );

    assert.ok(cache, 'the store is cached');
    assert.match(String(cache.with.path), /pnpm-store/);
    assert.ok(
      runs.steps.indexOf(cache) < runs.steps.indexOf(install),
      'the store is restored before install',
    );
    // The overlay root has no lockfile, so the store path must be passed explicitly.
    assert.match(String(install.run), /--store-dir "\$RUNNER_TEMP\/pnpm-store"/);
    assert.match(String(install.run), /--prefer-offline/);

    const hashed = String(cache.with.key)
      .match(/hashFiles\(([^)]*)\)/)[1]
      .split(',')
      .map((entry) => entry.trim().replaceAll("'", ''));

    assert.ok(
      hashed.some((entry) => entry.includes('package.json')),
      'the key follows dependency declarations',
    );
    for (const file of hashed.filter((entry) => !entry.includes('*'))) {
      assert.ok(!isIgnored(file), `${file} is gitignored, so CI would hash nothing`);
    }
  });
}
