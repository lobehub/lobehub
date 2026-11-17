import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parse } from 'yaml';

const load = async (path) => parse(await readFile(new URL(path, import.meta.url), 'utf8'));

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
  const { jobs } = await load('../workflows/overlay-type-check.yml');
  const { steps } = jobs['overlay-type-check'];
  const [head, base] = steps.filter((step) => step.uses === './.github/actions/overlay-type-check');

  assert.equal(head['continue-on-error'], true);
  assert.equal(base.with['overlay-ref'], '${{ env.OVERLAY_REF }}');
  assert.match(
    steps.at(-1).run,
    new RegExp(`overlayTypeErrors\\.mjs .*${base.with['log-name']}.*${head.with['log-name']}`),
  );
});
