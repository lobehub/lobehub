import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { outputJson } from '../../../utils/format';
import { assertReportLanguage } from '../language';

// ── report ──

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
  await assertReportLanguage(client, [
    { path: '--summary', text: options.summary },
    { path: '--content', text: options.content },
  ]);
  const created = await client.verify.upsertReport.mutate({
    content: options.content,
    failedChecks: num(options.failed),
    passedChecks: num(options.passed),
    summary: options.summary,
    totalChecks: num(options.total),
    uncertainChecks: num(options.uncertain),
    verdict: options.verdict as any,
    verifyRunId: options.run,
  });
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
