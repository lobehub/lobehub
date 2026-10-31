import { performance } from 'node:perf_hooks';

import { findCssModuleResidue, inventoryScope } from '../analysis/scopeInventory';
import type { DependencyOptions } from '../dependencies/dependencySnapshot';
import { restoreDependencies } from '../dependencies/dependencySnapshot';
import {
  mountFixtureDependencies,
  prepareFixtureDependencies,
} from '../dependencies/fixtureDependencies';
import { discoverFixtureCandidates, getStyleFixture } from '../fixtures/fixtureRegistry';
import { evaluateGate } from '../gate/gate';
import { summarizeComponentRun } from '../reporting/componentSummary';
import { writeArtifactManifest, writeHtmlReport, writeJson } from '../reporting/report';
import { prepareSourceSnapshots } from '../source/buildSnapshots';
import { closeRevisionSession, createRevisionSession } from '../source/revisionResolver';
import type { runComponentFixture } from './componentRunner';
import { runFixtureBatch } from './fixtureBatch';

export interface PreflightOptions {
  base: string;
  dependencyOptions?: DependencyOptions;
  fixture?: { browser?: string; id: string; sourceDirectory: string };
  fixtureBatch?: { browser?: string; ids: string[]; sourceDirectory: string };
  fixtureDependencies?: boolean;
  head: string;
  output: string;
  planOnly: boolean;
  pullRequest?: { baseRef: string; headRepository: string; number: number; repository: string };
  repository: string;
  verifierHash: string;
}

/** Preparation evidence has its own schema: do not fabricate a browser RunResult. */
export const runPreflight = async (options: PreflightOptions) => {
  const started = performance.now();
  if (options.fixture && options.fixtureBatch) throw new Error('CONFLICTING_FIXTURE_OPTIONS');
  const selected = options.fixtureBatch?.ids ?? (options.fixture ? [options.fixture.id] : []);
  const session = await createRevisionSession(options.repository, options.base, options.head);
  try {
    const scope = await inventoryScope(session);
    const migrationResidue = findCssModuleResidue(scope.units);
    const fixtures = discoverFixtureCandidates(scope);
    await writeJson(options.output, 'identity.json', session.identity);
    await writeJson(options.output, 'scope.json', scope);
    await writeJson(options.output, 'migration-residue.json', {
      cssModules: migrationResidue,
      scope: 'changed-files-only',
      completeMigrationProven: false,
    });
    await writeJson(options.output, 'fixtures.json', fixtures);
    const routing = !options.planOnly && scope.changedFiles.length === 0;
    const gateInput = {
      errors: [],
      findings: [],
      fixtures: [],
      fullScope: false,
      identityVerified: false,
      pureStyleMigration: false,
      units: scope.units.map((unit) => ({
        componentId: unit.file,
        fixtureIds: [],
        id: unit.id,
        requiredKeys: [],
      })),
      witnesses: [],
    };
    const snapshots =
      !routing && !options.planOnly
        ? await prepareSourceSnapshots(session, options.output)
        : undefined;
    let dependencies:
      | {
          base: Awaited<ReturnType<typeof restoreDependencies>>['snapshot'];
          candidate: Awaited<ReturnType<typeof restoreDependencies>>['snapshot'];
        }
      | undefined;
    if (snapshots && options.dependencyOptions) {
      const baseInputs = snapshots.base.dependencyInputs.map((input) => input.path);
      const candidateInputs = snapshots.candidate.dependencyInputs.map((input) => input.path);
      const capsules =
        options.fixtureDependencies && selected.length
          ? {
              base: await prepareFixtureDependencies(
                snapshots.base.directory,
                baseInputs,
                selected,
              ),
              candidate: await prepareFixtureDependencies(
                snapshots.candidate.directory,
                candidateInputs,
                selected,
              ),
            }
          : undefined;
      if (capsules) await writeJson(options.output, 'dependency-capsules.json', capsules);
      console.log('Restoring isolated dependencies: base');
      const base = await restoreDependencies(
        capsules?.base.directory ?? snapshots.base.directory,
        capsules?.base.inputs ?? baseInputs,
        options.dependencyOptions,
      );
      console.log('Restoring isolated dependencies: candidate');
      const sameInputs = capsules
        ? capsules.base.hash === capsules.candidate.hash
        : snapshots.base.dependencyInputHash === snapshots.candidate.dependencyInputHash;
      const candidate = await restoreDependencies(
        capsules?.candidate.directory ?? snapshots.candidate.directory,
        capsules?.candidate.inputs ?? candidateInputs,
        options.dependencyOptions,
        sameInputs ? base.lock : undefined,
      );
      if (sameInputs && candidate.snapshot.snapshotHash !== base.snapshot.snapshotHash)
        throw new Error('DEPENDENCY_RESTORE_DRIFT');
      dependencies = { base: base.snapshot, candidate: candidate.snapshot };
      await writeJson(options.output, 'dependencies.json', dependencies);
      if (capsules) {
        await mountFixtureDependencies(snapshots.base.directory);
        await mountFixtureDependencies(snapshots.candidate.directory);
      }
    }
    let component: Awaited<ReturnType<typeof runComponentFixture>> | undefined;
    let batch: Awaited<ReturnType<typeof runFixtureBatch>> | undefined;
    if (options.fixture && snapshots) {
      if (!dependencies) throw new Error('ISOLATED_DEPENDENCIES_REQUIRED');
      const { runComponentFixture } = await import('./componentRunner');
      component = await runComponentFixture({
        baseRoot: snapshots.base.directory,
        candidateRoot: snapshots.candidate.directory,
        browser: options.fixture.browser,
        fixture: getStyleFixture(options.fixture.id),
        output: options.output,
        sourceDirectory: options.fixture.sourceDirectory,
      });
    }
    if (options.fixtureBatch && snapshots) {
      if (!dependencies) throw new Error('ISOLATED_DEPENDENCIES_REQUIRED');
      batch = await runFixtureBatch({
        baseRoot: snapshots.base.directory,
        candidateRoot: snapshots.candidate.directory,
        browser: options.fixtureBatch.browser,
        fixtures: options.fixtureBatch.ids.map(getStyleFixture),
        output: options.output,
        sourceDirectory: options.fixtureBatch.sourceDirectory,
      });
    }
    const gate = evaluateGate({
      ...gateInput,
      errors: component?.result.errors ?? batch?.errors ?? [],
      findings: component?.result.findings ?? batch?.findings ?? [],
      fixtures: component?.result.fixtureResults ?? batch?.fixtureResults ?? [],
    });
    await writeJson(options.output, 'coverage.json', gate.coverage);
    const reasonCodes = routing
      ? ['NO_STYLE_IMPACT']
      : [
          ...(options.planOnly ? ['PLAN_ONLY'] : []),
          ...(!dependencies ? ['DEPENDENCY_SNAPSHOT_NOT_RESTORED'] : []),
          ...(options.fixtureDependencies
            ? ['FIXTURE_CAPSULE_WORKSPACE_PEER_CONTEXT_UNPROVEN']
            : []),
          'SOURCE_UNIT_BINDING_UNPROVEN',
          ...(!component && !batch ? ['BROWSER_VERIFICATION_NOT_RUN'] : []),
          ...gate.reasonCodes,
          ...scope.limitations,
        ];
    const result = {
      classificationEvidenceRefs: routing ? ['scope.json', 'identity.json'] : [],
      durationMs: performance.now() - started,
      dependencies,
      componentSummary: component ? summarizeComponentRun(component.result) : undefined,
      componentBatchSummary: batch?.summary,
      componentBatchRef: batch ? 'fixture-batch.json' : undefined,
      componentRunRef: component ? 'component-run.json' : undefined,
      fixtures,
      gateEligible: false as const,
      identity: session.identity,
      mode: 'preflight' as const,
      migrationResidueRef: 'migration-residue.json',
      pullRequest: options.pullRequest,
      reasonCodes,
      schemaVersion: 1 as const,
      scopeHash: scope.hash,
      snapshots,
      status: routing ? ('NOT_APPLICABLE' as const) : gate.status,
      unresolvedUnitIds: scope.units.map((unit) => unit.id),
      verifierHash: options.verifierHash,
    };
    await writeJson(options.output, 'preflight.json', result);
    await writeHtmlReport(options.output, result);
    await writeArtifactManifest(options.output, [
      'identity.json',
      'scope.json',
      'migration-residue.json',
      'fixtures.json',
      'coverage.json',
      'preflight.json',
      'report.html',
      ...(options.pullRequest ? ['pull-request.json'] : []),
      ...(dependencies ? ['dependencies.json'] : []),
      ...(options.fixtureDependencies && dependencies ? ['dependency-capsules.json'] : []),
      ...(component?.artifactFiles ?? []),
      ...(batch?.artifactFiles ?? []),
    ]);
    return result;
  } finally {
    await closeRevisionSession(session);
  }
};
