import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runComponentFixture } from './componentRunner';
import { summarizeComponentRun } from './componentSummary';
import { type StyleFixture, styleFixtureSchema } from './fixtureRegistry';
import { writeArtifactManifest, writeHtmlReport, writeJson } from './report';
import type { GateInput } from './types';

/** One frozen B/M pair and dependency capsule; isolated build namespace per
 * component. A failed component cannot skip the remaining planned components. */
export const runFixtureBatch = async (options: {
  baseRoot: string;
  browser?: string;
  candidateRoot: string;
  fixtures: StyleFixture[];
  output: string;
  sourceDirectory: string;
}) => {
  const started = performance.now();
  const errors: string[] = [];
  const findings: GateInput['findings'] = [];
  const fixtureResults: GateInput['fixtures'] = [];
  const artifactFiles: string[] = [];
  const entries: Array<{
    fixtureId: string;
    outcome: 'COMPLETED' | 'ERROR' | 'NOT_RUN';
    reason?: string;
    reportRef: string;
    summary?: ReturnType<typeof summarizeComponentRun>;
  }> = [];
  const fixtures = options.fixtures.map((fixture) => styleFixtureSchema.parse(fixture));
  const ids = fixtures.map((fixture) => fixture.id);
  if (!ids.length || ids.length > 32 || new Set(ids).size !== ids.length)
    throw new Error('INVALID_FIXTURE_BATCH');
  for (const fixture of fixtures) {
    const directory = path.join(options.output, 'components', fixture.id);
    await mkdir(directory, { recursive: true });
    await writeJson(directory, 'fixture-contract.json', fixture);
    try {
      // Reserve the two 60s sandbox build deadlines before starting new work.
      if (performance.now() - started >= 13 * 60_000) {
        const reason = 'FIXTURE_BATCH_TIME_BUDGET_EXCEEDED';
        findings.push({
          confirmed: false,
          id: `${fixture.id}:batch-budget`,
          reasonCode: reason,
          severity: 'review',
        });
        entries.push({
          fixtureId: fixture.id,
          outcome: 'NOT_RUN',
          reason,
          reportRef: `components/${fixture.id}/report.html`,
        });
        await writeJson(directory, 'not-run.json', {
          fixtureId: fixture.id,
          gateEligible: false,
          reason,
        });
        await writeHtmlReport(directory, { fixtureId: fixture.id, gateEligible: false, reason });
      } else {
        console.log(JSON.stringify({ phase: 'component-start', fixture: fixture.id }));
        const run = await runComponentFixture({ ...options, fixture, output: directory });
        const summary = summarizeComponentRun(run.result);
        errors.push(...run.result.errors.map((error) => `${fixture.id}:${error}`));
        findings.push(
          ...run.result.findings.map((finding) => ({
            ...finding,
            id: `${fixture.id}:${finding.id}`,
          })),
        );
        fixtureResults.push(...run.result.fixtureResults);
        entries.push({
          fixtureId: fixture.id,
          outcome: 'COMPLETED',
          reportRef: `components/${fixture.id}/report.html`,
          summary,
        });
        await writeJson(directory, 'component-summary.json', {
          ...summary,
          fixtureId: fixture.id,
          gateEligible: false,
        });
        await writeHtmlReport(directory, {
          ...summary,
          fixtureId: fixture.id,
          gateEligible: false,
          componentRunRef: 'component-run.json',
        });
        console.log(
          JSON.stringify({ phase: 'component-completed', fixture: fixture.id, ...summary }),
        );
      }
    } catch (error) {
      console.error(error);
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${fixture.id}:${reason}`);
      entries.push({
        fixtureId: fixture.id,
        outcome: 'ERROR',
        reason,
        reportRef: `components/${fixture.id}/report.html`,
      });
      await writeJson(directory, 'fixture-error.json', {
        fixtureId: fixture.id,
        gateEligible: false,
        reason,
      });
      await writeHtmlReport(directory, { fixtureId: fixture.id, gateEligible: false, reason });
    }
    const files = await readdir(directory, { withFileTypes: true });
    if (files.some((file) => !file.isFile())) throw new Error('UNEXPECTED_FIXTURE_REPORT_ENTRY');
    await writeArtifactManifest(
      directory,
      files.map((file) => file.name),
    );
    artifactFiles.push(`components/${fixture.id}/artifacts.json`);
  }
  const summary = {
    completed: entries.filter((entry) => entry.outcome === 'COMPLETED').length,
    different: entries.filter((entry) => entry.summary?.sampledStyleStatus === 'DIFFERENT').length,
    equalInSamples: entries.filter(
      (entry) => entry.summary?.sampledStyleStatus === 'EQUAL_IN_SAMPLES',
    ).length,
    errors: entries.filter(
      (entry) => entry.outcome === 'ERROR' || entry.summary?.sampledStyleStatus === 'ERROR',
    ).length,
    notRun: entries.filter((entry) => entry.outcome === 'NOT_RUN').length,
    planned: ids.length,
    review: entries.filter(
      (entry) =>
        entry.summary &&
        !['DIFFERENT', 'EQUAL_IN_SAMPLES', 'ERROR'].includes(entry.summary.sampledStyleStatus),
    ).length,
  };
  await writeJson(options.output, 'fixture-batch.json', {
    durationMs: performance.now() - started,
    entries,
    gateEligible: false,
    plannedFixtureIds: ids,
    summary,
  });
  artifactFiles.push('fixture-batch.json');
  return { artifactFiles, errors, findings, fixtureResults, summary };
};
