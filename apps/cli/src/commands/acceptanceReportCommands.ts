import { verifySurfaces } from '@lobechat/const/verify';
import type { Command } from 'commander';
import { Option } from 'commander';

import { outputJson } from '../utils/format';
import {
  createAcceptanceReportTemplate,
  getAcceptanceReportJsonSchema,
  validateAcceptanceReport,
} from './acceptanceReportSchema';

export interface IngestReportOptions {
  acceptance?: string;
  /** Run every local check, including the report language, then stop before publishing. */
  dryRun?: boolean;
  goal?: string;
  json?: boolean | string;
  open?: boolean;
  operation?: string;
  requirement?: string;
  source?: string;
  subject?: string;
  title?: string;
}

export function withIngestReportOptions(cmd: Command): Command {
  return cmd
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option('--operation <id>', 'Link the session to an existing Agent Run')
    .option('--acceptance <id>', 'Append this round to an existing acceptance')
    .option('--title <title>', 'Override the session title')
    .option('--goal <goal>', 'The goal/task being verified')
    .option(
      '--subject <type:id>',
      'Attach to a task/topic/document (defaults to the current topic; otherwise standalone)',
    )
    .option(
      '--requirement <text>',
      'Acceptance requirement recorded when the aggregate is first created',
    )
    .option('--open', 'Print the in-app URL to open the report')
    .option(
      '--dry-run',
      'Validate the report (including its account language) without publishing; use run validate for offline checks',
    )
    .option('--json [fields]', 'Output JSON');
}

/** Local authoring commands deliberately do not create an API client. */
export function attachAcceptanceReportCommands(
  run: Command,
  ingestAction: (reportDir: string, options: IngestReportOptions) => Promise<void>,
): void {
  run
    .command('schema')
    .description('Print the result.json authoring JSON Schema, without login or network access')
    .option('--example', 'Print a draft result.json with no executed cases')
    .addOption(
      new Option('--surface <surface>', 'Surface for the example plan')
        .choices(verifySurfaces)
        .default('web'),
    )
    .option('--json [fields]', 'Output JSON (default); optionally select top-level fields')
    .action(
      (options: {
        example?: boolean;
        json?: boolean | string;
        surface: (typeof verifySurfaces)[number];
      }) => {
        outputJson(
          options.example
            ? createAcceptanceReportTemplate(options.surface)
            : getAcceptanceReportJsonSchema(),
          options.json,
        );
      },
    );

  run
    .command('validate <reportDir>')
    .description('Check local result.json and evidence files offline; never publish')
    .option('--json [fields]', 'Output JSON (default); optionally select top-level fields')
    .addHelpText(
      'after',
      '\nChecks the authoring schema, check IDs and local evidence. Account language, media inspection and remote plan membership remain unchecked. Invalid reports exit with code 1. Drafts are valid but unexecuted. Use ingest --dry-run for account checks.',
    )
    .action(async (reportDir: string, options: { json?: boolean | string }) => {
      const result = await validateAcceptanceReport(reportDir);
      outputJson(result, options.json);
      if (!result.valid) process.exitCode = 1;
    });

  withIngestReportOptions(
    run
      .command('ingest <reportDir>')
      .description(
        'Ingest a local agent-testing report (result.json + report.md + proposal.md + assets) as a new round',
      ),
  ).action(ingestAction);
}
