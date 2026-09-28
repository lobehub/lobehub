import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runFixtureLint } from './runFixtures';

/**
 * Calibration: every `bad-*` fixture must produce a finding for its rule on
 * the line below each standalone `// alint-expect` comment (±1 line), every
 * `good-*` fixture must produce none. Runs only when a provider is set up (`bun run alint:setup`);
 * without `.alint/config.toml` the suite is skipped, not failed.
 */
const alintDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(alintDir, '../..');

/**
 * Where rules live, and the plugin prefix `alint.config.toml` registers each
 * under. Repo-wide rules sit here; a package-level rule sits next to the code
 * it describes, so it is only ever scoped to that package.
 */
const FIXTURE_ROOTS = [
  { dir: 'packages/alint/fixtures', prefix: 'lobehub' },
  { dir: 'packages/heterogeneous-agents/alint/fixtures', prefix: 'hetero' },
];

const hasSetup = await readFile(path.join(rootDir, '.alint/config.toml'), 'utf8')
  .then(() => true)
  .catch(() => false);

/** Every fixture file, with the rule id its findings must carry. */
const fixtures = (
  await Promise.all(
    FIXTURE_ROOTS.map(async ({ dir, prefix }) => {
      const ruleDirs = (await readdir(path.join(rootDir, dir), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      return Promise.all(
        ruleDirs.map(async (rule) =>
          (await readdir(path.join(rootDir, dir, rule))).sort().map((file) => ({
            file: path.join(dir, rule, file),
            rule: `${prefix}/${rule}`,
          })),
        ),
      );
    }),
  )
).flat(2);

const fixtureFiles = fixtures.map(({ file }) => file);
const ruleOf = (file: string) => fixtures.find((fixture) => fixture.file === file)!.rule;

const expectedLines = async (file: string) =>
  (await readFile(path.join(rootDir, file), 'utf8'))
    .split('\n')
    .flatMap((line, index) => (line.trim() === '// alint-expect' ? [index + 2] : []));

describe.skipIf(!hasSetup)('alint rule fixtures', async () => {
  const diagnostics = hasSetup ? await runFixtureLint(rootDir, fixtureFiles) : [];
  const byFile = (file: string) => diagnostics.filter((d) => d.file === file);

  it.each(fixtureFiles)('%s', async (file) => {
    const rule = ruleOf(file);
    const findings = byFile(file);
    const foreign = findings.filter((d) => d.rule !== rule).map((d) => d.rule);
    expect(foreign, 'a fixture only meets its own rule').toEqual([]);

    if (path.basename(file).startsWith('good-')) {
      expect(findings.map((d) => `${d.line}: ${d.message}`)).toEqual([]);
      return;
    }

    const expected = await expectedLines(file);
    expect(
      expected.length,
      'bad fixtures put // alint-expect on the line above the offending one',
    ).toBeGreaterThan(0);
    for (const line of expected) {
      const hit = findings.find((d) => Math.abs(d.line - line) <= 1);
      expect(
        hit,
        `expected a ${rule} finding near line ${line}; got ${JSON.stringify(findings)}`,
      ).toBeDefined();
    }
  });
});
