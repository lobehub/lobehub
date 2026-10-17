import type { Command } from 'commander';

import { getTrpcClient } from '../../../api/client';
import { log } from '../../../utils/logger';
import { installAction, type InstallOptions, withInstallOptions } from '../install';
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

// ── Deprecated aliases: keep the old `lh verify …` spellings working ──

/** Warn once that a `lh verify` spelling has moved under `lh acceptance`. */
function deprecate(cmd: Command, replacement: string): Command {
  return cmd.hook('preAction', () => {
    log.warn(
      `\`lh verify ${cmd.name()}\` is deprecated — use \`${replacement}\` (removed in a future release)`,
    );
  });
}

/**
 * The pre-move `lh verify …` command surface, kept as thin aliases that wire the
 * exact same actions. Scheduled for removal once callers migrate to
 * `lh acceptance`. Layout mirrors the original flat shape so existing scripts and
 * tests keep working.
 */
export function attachDeprecatedVerifyRunAliases(verify: Command): void {
  // Both legacy spellings — `verify init` (server pull) and `verify install`
  // (the old bundled-skill installer) — converge on `acceptance install`.
  deprecate(
    withInstallOptions(
      verify.command('init').description('Deprecated — use `lh acceptance install`'),
    ),
    'lh acceptance install',
  ).action(async (options: InstallOptions) => installAction(options, await getTrpcClient()));

  deprecate(
    withInstallOptions(
      verify.command('install').description('Deprecated — use `lh acceptance install`'),
    ),
    'lh acceptance install',
  ).action(async (options: InstallOptions) => installAction(options, await getTrpcClient()));

  deprecate(
    withIngestReportOptions(
      verify
        .command('ingest-report <reportDir>')
        .description('Deprecated — use `lh acceptance run ingest`'),
    ),
    'lh acceptance run ingest',
  ).action(ingestReportAction);

  const run = verify.command('run').description('Deprecated — use `lh acceptance run`');
  deprecate(
    withRunCreateOptions(
      run.command('create').description('Deprecated — use `lh acceptance run create`'),
    ),
    'lh acceptance run create',
  ).action(runCreateAction);
  run
    .command('list')
    .description('Deprecated — use `lh acceptance run list`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify run list` is deprecated — use `lh acceptance run list`'),
    )
    .action(runListAction);
  run
    .command('get <runId>')
    .description('Deprecated — use `lh acceptance run get`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify run get` is deprecated — use `lh acceptance run get`'),
    )
    .action(runGetAction);
  deprecate(
    withRunDeleteOptions(
      run.command('delete <runId>').description('Deprecated — use `lh acceptance run delete`'),
    ),
    'lh acceptance run delete',
  ).action(runDeleteAction);

  const result = verify
    .command('result')
    .description('Deprecated — use `lh acceptance run result`');
  deprecate(
    withResultIngestOptions(
      result.command('ingest').description('Deprecated — use `lh acceptance run result ingest`'),
    ),
    'lh acceptance run result ingest',
  ).action(resultIngestAction);
  deprecate(
    withResultListOptions(
      result.command('list').description('Deprecated — use `lh acceptance run result list`'),
    ),
    'lh acceptance run result list',
  ).action(resultListAction);

  deprecate(
    withSubmitOptions(
      verify.command('submit').description('Deprecated — use `lh acceptance run result submit`'),
    ),
    'lh acceptance run result submit',
  ).action(submitAction);

  verify
    .command('decision <resultId> <decision>')
    .description('Deprecated — use `lh acceptance run result decision`')
    .hook('preAction', () =>
      log.warn('`lh verify decision` is deprecated — use `lh acceptance run result decision`'),
    )
    .action(decisionAction);

  const evidence = verify
    .command('evidence')
    .description('Deprecated — use `lh acceptance run evidence`');
  deprecate(
    withEvidenceUploadOptions(
      evidence
        .command('upload')
        .description('Deprecated — use `lh acceptance run evidence upload`'),
    ),
    'lh acceptance run evidence upload',
  ).action(evidenceUploadAction);
  evidence
    .command('list <checkResultId>')
    .description('Deprecated — use `lh acceptance run evidence list`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify evidence list` is deprecated — use `lh acceptance run evidence list`'),
    )
    .action(evidenceListAction);
  evidence
    .command('delete <evidenceId>')
    .description('Deprecated — use `lh acceptance run evidence delete`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn(
        '`lh verify evidence delete` is deprecated — use `lh acceptance run evidence delete`',
      ),
    )
    .action(evidenceDeleteAction);

  const report = verify
    .command('report')
    .description('Deprecated — use `lh acceptance run report`');
  deprecate(
    withReportUpsertOptions(
      report.command('upsert').description('Deprecated — use `lh acceptance run report upsert`'),
    ),
    'lh acceptance run report upsert',
  ).action(reportUpsertAction);
  report
    .command('get <runId>')
    .description('Deprecated — use `lh acceptance run report get`')
    .option('--json [fields]', 'Output JSON')
    .hook('preAction', () =>
      log.warn('`lh verify report get` is deprecated — use `lh acceptance run report get`'),
    )
    .action(reportGetAction);
}
