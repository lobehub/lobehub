import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { fixtureIds, getStyleFixture } from './fixtureRegistry';
import { exitCode } from './gate';
import { runPreflight } from './preflight';
import { resolvePullRequest } from './pullRequest';
import { fingerprintSources, writeJson } from './report';

const help = `StyleX migration verification — local M1 foundation (advisory only)

  bun run stylex:verify --base <ref> --head <ref> [--plan-only]
  bun run stylex:verify --pr <number> [--repo owner/name] [--plan-only]
  bun run stylex:verify --base <ref> --head <ref> --restore-dependencies [--dependency-store <path>]
  bun run stylex:verify --base <ref> --head <ref> --restore-dependencies --fixture LiteTable
  bun run stylex:verify --base <ref> --head <ref> --restore-dependencies --fixture LiteTable --fixture-dependencies
  bun run stylex:verify --base <ref> --head <ref> --restore-dependencies --fixtures DotsLoading,UnreadDot --fixture-dependencies
  bun run stylex:verify self-test [--browser <executable>]

Options: --output <parent-directory>, --repository <local-path>, --help
Available fixtures: ${fixtureIds.join(', ')}
Revision objects must exist locally. No Git fetch, GitHub writes or PR merges.
Dependency restore is opt-in, offline by default; --dependency-network explicitly enables public npm preparation.
Dependency scripts/hooks and credentials are disabled; component builds run in an offline macOS sandbox.
Default: export both complete source trees and report remaining verification gaps.
No PR receives PASS until isolated dependencies and certified fixture binding exist.
Exit: PASS 0 (self-test only), FAIL 1, NEEDS_REVIEW 2, ERROR 3, no change 4.
`;

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'base': { type: 'string' },
      'browser': { type: 'string' },
      'dependency-network': { type: 'boolean' },
      'dependency-store': { type: 'string' },
      'head': { type: 'string' },
      'fixture': { type: 'string' },
      'fixtures': { type: 'string' },
      'fixture-dependencies': { type: 'boolean' },
      'help': { short: 'h', type: 'boolean' },
      'output': { type: 'string' },
      'plan-only': { type: 'boolean' },
      'pr': { type: 'string' },
      'pnpm': { type: 'string' },
      'restore-dependencies': { type: 'boolean' },
      'repo': { type: 'string' },
      'repository': { type: 'string' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (positionals.length > 1 || (positionals.length && positionals[0] !== 'self-test'))
    throw new Error('UNSUPPORTED_COMMAND');
  const selfTest = positionals[0] === 'self-test';
  if (
    (values['dependency-network'] || values['dependency-store'] || values.pnpm) &&
    !values['restore-dependencies']
  )
    throw new Error('DEPENDENCY_OPTIONS_REQUIRE_RESTORE');
  if (values['restore-dependencies'] && (selfTest || values['plan-only']))
    throw new Error('DEPENDENCY_RESTORE_REQUIRES_FULL_SOURCE');
  if (values.fixture && values.fixtures) throw new Error('CONFLICTING_FIXTURE_OPTIONS');
  const selectedFixtures = values.fixtures?.split(',').map((id) => id.trim());
  if (
    selectedFixtures &&
    (!selectedFixtures.length ||
      selectedFixtures.length > 32 ||
      new Set(selectedFixtures).size !== selectedFixtures.length ||
      selectedFixtures.some((id) => !id))
  )
    throw new Error('INVALID_FIXTURE_SELECTION');
  if (
    (values.fixture || values.fixtures) &&
    (!values['restore-dependencies'] || selfTest || values['plan-only'])
  )
    throw new Error('FIXTURE_REQUIRES_ISOLATED_DEPENDENCIES');
  if (values.fixture) getStyleFixture(values.fixture);
  selectedFixtures?.forEach(getStyleFixture);
  if (values['fixture-dependencies'] && !values.fixture && !values.fixtures)
    throw new Error('FIXTURE_DEPENDENCIES_REQUIRE_FIXTURE');
  if (selfTest && (values.pr || values.base || values.head || values['plan-only']))
    throw new Error('INVALID_SELF_TEST_OPTIONS');
  if (
    !selfTest &&
    ((!values.pr && (!values.base || !values.head)) || (values.pr && (values.base || values.head)))
  )
    throw new Error('Specify --pr OR both --base and --head');
  if (!selfTest && values.browser && !values.fixture && !values.fixtures)
    throw new Error('--browser requires self-test or --fixture');
  const repository = path.resolve(
    values.repository ?? process.env.STYLEX_VERIFIER_REPOSITORY ?? process.cwd(),
  );
  const sourceDirectory = process.env.STYLEX_VERIFIER_SOURCE_DIRECTORY;
  if (!sourceDirectory)
    throw new Error('Run through bun run stylex:verify to bind verifier sources');
  const verifierHash = await fingerprintSources([
    sourceDirectory,
    path.resolve(sourceDirectory, '../experiment'),
  ]);
  if (verifierHash !== process.env.STYLEX_VERIFIER_SOURCE_HASH)
    throw new Error('VERIFIER_SOURCE_HASH_MISMATCH');
  const parent = path.resolve(
    values.output ?? path.join(repository, '.records/stylex-verification'),
  );
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(path.join(parent, `${selfTest ? 'self-test' : 'run'}-`));
  console.log(`Evidence: ${output}`);
  // Bounded process watchdog also covers page.evaluate calls without protocol timeouts.
  const watchdog = setTimeout(
    () => {
      console.error('ERROR: VERIFICATION_TIME_BUDGET_EXCEEDED');
      process.exit(3);
    },
    values['restore-dependencies'] ? 900_000 : 120_000,
  );
  watchdog.unref();
  try {
    if (selfTest) {
      const { runSelfTest } = await import('./selfTest');
      const result = await runSelfTest(output, verifierHash, values.browser);
      console.log(JSON.stringify(result));
      process.exitCode = exitCode(result.status);
      return;
    }
    let base = values.base;
    let head = values.head;
    let pullRequest: Awaited<ReturnType<typeof resolvePullRequest>> | undefined;
    if (values.pr) {
      if (!/^[1-9]\d*$/.test(values.pr) || !Number.isSafeInteger(Number(values.pr)))
        throw new Error('INVALID_PR_NUMBER');
      const pr = await resolvePullRequest(repository, Number(values.pr), values.repo);
      pullRequest = pr;
      await writeJson(output, 'pull-request.json', pr);
      base = pr.base;
      head = pr.head;
    }
    if (!base || !head) throw new Error('MISSING_REVISIONS');
    const result = await runPreflight({
      base,
      dependencyOptions: values['restore-dependencies']
        ? {
            allowNetwork: values['dependency-network'] ?? false,
            pnpm: values.pnpm ?? 'pnpm',
            store: path.resolve(
              values['dependency-store'] ?? path.join(output, 'dependency-store'),
            ),
          }
        : undefined,
      fixture: values.fixture
        ? {
            browser: values.browser,
            id: values.fixture,
            sourceDirectory,
          }
        : undefined,
      fixtureDependencies: values['fixture-dependencies'] ?? false,
      fixtureBatch: selectedFixtures
        ? { browser: values.browser, ids: selectedFixtures, sourceDirectory }
        : undefined,
      head,
      output,
      planOnly: values['plan-only'] ?? false,
      pullRequest,
      repository,
      verifierHash,
    });
    console.log(
      JSON.stringify({
        changedFiles: result.fixtures.unmappedFiles.length + result.fixtures.candidates.length,
        component: result.componentSummary,
        componentBatch: result.componentBatchSummary,
        gateEligible: result.gateEligible,
        reasonCodes: result.reasonCodes,
        report: path.join(output, 'report.html'),
        status: result.status,
        units: result.unresolvedUnitIds.length,
      }),
    );
    process.exitCode = exitCode(result.status);
  } catch (error) {
    console.error(error);
    await writeJson(output, 'error.json', {
      gateEligible: false,
      message: error instanceof Error ? error.message : String(error),
      mode: selfTest ? 'self-test' : 'preflight',
      schemaVersion: 1,
      status: 'ERROR',
      verifierHash,
    });
    process.exitCode = 3;
  } finally {
    clearTimeout(watchdog);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 3;
});
