// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { getStyleFixture } from '../fixtures/fixtureRegistry';
import { runFixtureBatch } from '../pipeline/fixtureBatch';
import { sha256 } from '../reporting/report';

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});

it('retains each failed component and attempts the rest without fabricating comparisons', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-fixture-batch-test-'));
  owned.push(root);
  const options = {
    baseRoot: path.join(root, 'base'),
    candidateRoot: path.join(root, 'candidate'),
    fixtures: ['DotsLoading', 'UnreadDot'].map(getStyleFixture),
    output: path.join(root, 'evidence'),
    sourceDirectory: path.resolve(import.meta.dirname, '..'),
  };
  for (const directory of [options.baseRoot, options.candidateRoot, options.output])
    await mkdir(directory);
  // Both exported source entries are genuinely missing. No build/browser mock.
  const result = await runFixtureBatch(options);
  expect(result.summary).toMatchObject({ planned: 2, completed: 0, errors: 2, equalInSamples: 0 });
  expect(result.errors[0]).toContain('DotsLoading');
  expect(result.errors[1]).toContain('UnreadDot');
  expect(result.fixtureResults).toEqual([]);
  for (const fixture of options.fixtures) {
    const directory = path.join(options.output, 'components', fixture.id);
    const error = JSON.parse(await readFile(path.join(directory, 'fixture-error.json'), 'utf8'));
    expect(error).toMatchObject({ fixtureId: fixture.id, gateEligible: false });
    const artifacts = JSON.parse(
      await readFile(path.join(directory, 'artifacts.json'), 'utf8'),
    ) as Array<{ path: string; sha256: string }>;
    expect(artifacts.map((entry) => entry.path)).toContain('report.html');
    for (const entry of artifacts)
      expect(sha256(await readFile(path.join(directory, entry.path)))).toBe(entry.sha256);
  }
});

it('rejects untrusted fixture IDs before writing outside the component namespace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-fixture-batch-test-'));
  owned.push(root);
  await expect(
    runFixtureBatch({
      baseRoot: root,
      candidateRoot: root,
      output: root,
      sourceDirectory: root,
      fixtures: [{ ...getStyleFixture('DotsLoading'), id: '../escape' }],
    }),
  ).rejects.toThrow();
});
