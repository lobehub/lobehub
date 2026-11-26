import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parse } from 'yaml';

const loadJobs = async () =>
  parse(await readFile(new URL('../workflows/release-desktop-canary.yml', import.meta.url), 'utf8'))
    .jobs;

const needsOf = (job) => [job.needs ?? []].flat();

test('a force_full run reaches every release job although core-ota is skipped', async () => {
  const jobs = await loadJobs();
  assert.match(String(jobs['core-ota'].if), /!inputs\.force_full/);

  // A skipped ancestor skips every job left on the default success() condition, so each job
  // downstream of core-ota must state its own condition on its direct dependencies.
  const downstream = new Set(['core-ota']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, job] of Object.entries(jobs)) {
      if (!downstream.has(id) && needsOf(job).some((need) => downstream.has(need))) {
        downstream.add(id);
        grew = true;
      }
    }
  }
  downstream.delete('core-ota');
  assert.ok(
    downstream.has('build') && downstream.has('publish-s3') && downstream.has('publish-sparkle'),
  );

  for (const id of downstream) {
    const condition = String(jobs[id].if ?? '');
    assert.match(
      condition,
      /!cancelled\(\)/,
      `${id} must not rely on the default success() condition`,
    );
    // calculate-version gates on check-trigger's outputs and core-ota's result itself.
    if (id === 'calculate-version') continue;
    for (const need of needsOf(jobs[id])) {
      assert.ok(
        condition.includes(`needs.${need}.result == 'success'`),
        `${id} must require ${need} to have succeeded`,
      );
    }
  }
});
