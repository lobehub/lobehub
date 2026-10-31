import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../../utils/format';
import { assertReportLanguage } from '../language';

// ── run ──

export interface RunCreateOptions {
  goal?: string;
  json?: boolean | string;
  operation?: string;
  source?: string;
  title?: string;
}

export async function runCreateAction(options: RunCreateOptions): Promise<void> {
  const client = await getTrpcClient();
  await assertReportLanguage(client, [
    { path: '--title', text: options.title },
    { path: '--goal', text: options.goal },
  ]);
  const created = await client.verify.createRun.mutate({
    goal: options.goal,
    operationId: options.operation,
    source: options.source as any,
    title: options.title,
  });
  if (options.json !== undefined) {
    outputJson(created, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Created run ${pc.bold(created.id)}`);
}

export async function runListAction(options: { json?: boolean | string }): Promise<void> {
  const client = await getTrpcClient();
  const runs = await client.verify.listRuns.query();
  if (options.json !== undefined) {
    outputJson(runs, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (runs.length === 0) return void console.log('No runs found.');
  printTable(
    runs.map((r: any) => [
      r.id,
      truncate(r.title || '', 40),
      r.source,
      r.status ?? '',
      r.operationId ? 'agent' : 'standalone',
      r.createdAt ? timeAgo(r.createdAt) : '',
    ]),
    ['ID', 'TITLE', 'SOURCE', 'STATUS', 'KIND', 'CREATED'],
  );
}

export async function runGetAction(
  runId: string,
  options: { json?: boolean | string },
): Promise<void> {
  const client = await getTrpcClient();
  const item = await client.verify.getRun.query({ verifyRunId: runId });
  if (options.json !== undefined) {
    outputJson(item, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  if (!item) return void console.log('Run not found.');
  console.log(JSON.stringify(item, null, 2));
}

export async function runDeleteAction(
  runId: string,
  options: { json?: boolean | string; yes?: boolean },
): Promise<void> {
  const client = await getTrpcClient();
  if (!options.yes) {
    const ok = await confirm(
      `Delete run ${pc.bold(runId)} and all its results, evidence and report? This cannot be undone.`,
    );
    if (!ok) return void console.log('Aborted.');
  }
  const result = await client.verify.deleteRun.mutate({ verifyRunId: runId });
  if (options.json !== undefined) {
    outputJson(result, typeof options.json === 'string' ? options.json : undefined);
    return;
  }
  console.log(`${pc.green('✓')} Deleted run ${pc.bold(result.id)}`);
}

export function withRunCreateOptions(cmd: Command): Command {
  return cmd
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option('--operation <id>', 'Link to an existing Agent Run')
    .option('--title <title>', 'Session title')
    .option('--goal <goal>', 'Goal/task being verified')
    .option('--json [fields]', 'Output JSON');
}

export function withRunDeleteOptions(cmd: Command): Command {
  return cmd
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json [fields]', 'Output JSON');
}
