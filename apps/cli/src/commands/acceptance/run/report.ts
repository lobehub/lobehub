import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { isOperationTokenRefusal } from '../../../api/operationToken';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { assertReportLanguage } from '../language';

// ── report ──

/**
 * What a run can do once its operation token is refused on `report upsert`.
 *
 * The refusal is deliberate: the report carries the round's verdict, so the
 * round's verifier writes it, and `upsertReport` stays off the operation-token
 * allowlist. A token without `acceptance:evidence` is refused one step earlier,
 * on the language check's `user.getUserState`, and is no closer to writing it.
 * A run never retries with the machine's stored login, so the refusal is
 * final. The commands below take the run's own operation id,
 * which the token is bound to.
 */
export const reportRefusalGuidance = (runId: string): string[] => {
  const operation = process.env.LOBEHUB_OPERATION_ID || '<operationId>';
  return [
    `This run's token cannot write the report of round ${runId}: a round's report and verdict are written by that round's verifier.`,
    `  Check for a plan round: lh acceptance plan state ${operation} (it has one when "confirmed" shows a time).`,
    '  With a plan round, hand in evidence instead:',
    `    lh acceptance run ingest <reportDir> --operation ${operation}`,
    `    lh acceptance run result submit --operation ${operation} --item <checkItemId> --type <type> --file <path>`,
    '  Without one, or if that check is refused too, report the handoff as blocked. Do not retry report upsert.',
  ];
};

export interface ReportUpsertOptions {
  content?: string;
  failed?: string;
  json?: boolean | string;
  passed?: string;
  run: string;
  summary?: string;
  total?: string;
  uncertain?: string;
  verdict?: string;
}

export async function reportUpsertAction(options: ReportUpsertOptions): Promise<void> {
  const num = (s?: string) => (s === undefined ? undefined : Number.parseInt(s, 10));
  const client = await getTrpcClient();
  let created: Awaited<ReturnType<typeof client.verify.upsertReport.mutate>>;
  try {
    await assertReportLanguage(client, [
      { path: '--summary', text: options.summary },
      { path: '--content', text: options.content },
    ]);
    created = await client.verify.upsertReport.mutate({
      content: options.content,
      failedChecks: num(options.failed),
      passedChecks: num(options.passed),
      summary: options.summary,
      totalChecks: num(options.total),
      uncertainChecks: num(options.uncertain),
      verdict: options.verdict as any,
      verifyRunId: options.run,
    });
  } catch (error) {
    if (!isOperationTokenRefusal(error)) throw error;
    for (const line of reportRefusalGuidance(options.run)) log.error(line);
    process.exit(1);
  }
  if (options.json !== undefined) {
    outputJson(created, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Report ${pc.bold(created.id)} (${created.verdict ?? '—'})`);
}

export async function reportGetAction(
  runId: string,
  options: { json?: boolean | string },
): Promise<void> {
  const client = await getTrpcClient();
  const item = await client.verify.getReport.query({ verifyRunId: runId });
  if (options.json !== undefined) {
    outputJson(item, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (!item) return void console.log('No report.');
  console.log(JSON.stringify(item, null, 2));
}

export function withReportUpsertOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--run <verifyRunId>', 'Target session id')
    .option('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--summary <text>', 'Short summary')
    .option('--content <markdown>', 'Full markdown body')
    .option('--total <n>', 'Total checks')
    .option('--passed <n>', 'Passed checks')
    .option('--failed <n>', 'Failed checks')
    .option('--uncertain <n>', 'Uncertain checks')
    .option('--json [fields]', 'Output JSON');
}
