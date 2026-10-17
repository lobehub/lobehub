import type { Command } from 'commander';

import { createPublicLambdaClient } from '../../../api/client';
import { installAction, type InstallOptions, withInstallOptions } from '../install';
import { DECISIONS } from '../utils';
import {
  evidenceDeleteAction,
  evidenceListAction,
  evidenceUploadAction,
  withEvidenceUploadOptions,
} from './evidence';
import { ingestReportAction, withIngestReportOptions } from './ingest';
import { reportGetAction, reportUpsertAction, withReportUpsertOptions } from './report';
import {
  decisionAction,
  resultIngestAction,
  resultListAction,
  submitAction,
  withResultIngestOptions,
  withResultListOptions,
  withSubmitOptions,
} from './result';
import {
  runCreateAction,
  runDeleteAction,
  runGetAction,
  runListAction,
  withRunCreateOptions,
  withRunDeleteOptions,
} from './session';

// ── Actions ────────────────────────────────────────────────
//
// One implementation per command, shared by the canonical `lh acceptance run …`
// tree and the deprecated `lh verify …` aliases. Both wire the same function, so
// the two spellings never drift while the aliases live out their deprecation.

// ── Canonical tree: `lh acceptance install` + `lh acceptance run …` ──

/**
 * The run-scoped acceptance commands. A run is one immutable round of a
 * subject's acceptance; its results, evidence, and report are its sub-resources.
 * Attached to the first-class `lh acceptance` command.
 */
export function attachAcceptanceRunCommands(acceptance: Command): void {
  withInstallOptions(
    acceptance
      .command('install')
      .description('Install the latest acceptance skill source into .agents/skills/acceptance'),
  ).action((options: InstallOptions) => installAction(options, createPublicLambdaClient()));

  withInstallOptions(
    acceptance
      .command('update')
      .description('Download the latest skill source, replacing its files and re-wiring harnesses'),
  ).action((options: InstallOptions) =>
    installAction({ ...options, force: true }, createPublicLambdaClient()),
  );

  const run = acceptance
    .command('run')
    .description('Acceptance rounds (immutable verification snapshots)');

  withIngestReportOptions(
    run
      .command('ingest <reportDir>')
      .description(
        'Ingest a local agent-testing report (result.json + report.md + proposal.md + assets) as a new round',
      ),
  ).action(ingestReportAction);

  withRunCreateOptions(
    run.command('create').description('Create a standalone round (verification session)'),
  ).action(runCreateAction);

  run
    .command('list')
    .description('List recent rounds')
    .option('--json [fields]', 'Output JSON')
    .action(runListAction);

  run
    .command('get <runId>')
    .description('Show a round')
    .option('--json [fields]', 'Output JSON')
    .action(runGetAction);

  withRunDeleteOptions(
    run
      .command('delete <runId>')
      .description('Delete a round (cascades its results, evidence and report)'),
  ).action(runDeleteAction);

  const result = run.command('result').description('Check results within a round');
  withResultIngestOptions(
    result
      .command('ingest')
      .description('Upsert one check result by (run, checkItemId) from a supplied verdict'),
  ).action(resultIngestAction);
  withResultListOptions(
    result
      .command('list')
      .description('List check results — by round (--run) or by Agent Run (--operation)'),
  ).action(resultListAction);
  withSubmitOptions(
    result
      .command('submit')
      .description('Submit a check item — upsert its result and attach evidence in one call'),
  ).action(submitAction);
  result
    .command('decision <resultId> <decision>')
    .description(`Record human feedback on a result (${DECISIONS.join('|')})`)
    .action(decisionAction);

  const evidence = run.command('evidence').description('Evidence artifacts within a round');
  withEvidenceUploadOptions(
    evidence
      .command('upload')
      .description('Attach an evidence artifact (file or inline text) to a check result'),
  ).action(evidenceUploadAction);
  evidence
    .command('list <checkResultId>')
    .description('List evidence for a check result')
    .option('--json [fields]', 'Output JSON')
    .action(evidenceListAction);
  evidence
    .command('delete <evidenceId>')
    .description('Delete an evidence artifact')
    .option('--json [fields]', 'Output JSON')
    .action(evidenceDeleteAction);

  const report = run.command('report').description('The narrative report of a round');
  withReportUpsertOptions(
    report.command('upsert').description('Write (overwrite) the report for a round'),
  ).action(reportUpsertAction);
  report
    .command('get <runId>')
    .description('Show the report for a round')
    .option('--json [fields]', 'Output JSON')
    .action(reportGetAction);
}

export { attachDeprecatedVerifyRunAliases } from './deprecatedAliases';
