import { FileGoalTraceStore } from '@lobechat/agent-tracing';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { printTable, timeAgo } from '../../../utils/format';
import { log } from '../../../utils/logger';

const DEFAULT_LIMIT = 20;

/**
 * Shape of one `agentTrace.listGoalTraces` row. Declared locally because the
 * CLI's standalone `tsc` run cannot resolve the `@/server/routers/lambda` path
 * alias, so TRPC results widen to `any` here (same reason `op/list.ts` does).
 */
interface GoalTraceRow {
  advancesByTrigger: Record<string, number> | null;
  advancesTotal: number | null;
  finalStatus: string | null;
  goalId: string;
  hasTrace: boolean;
  startedAt: Date | string | null;
  title: string;
}

/** `sweep=38 settle=112` — the split that says how much of a run was the safety net. */
const formatTriggers = (counts: Record<string, number> | null): string => {
  if (!counts) return '-';
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? '-' : entries.map(([key, n]) => `${key}=${n}`).join(' ');
};

/**
 * Server-side listing for `--server`: goals live on the server, so this is the
 * only way to see a run recorded anywhere but this machine. Local-first
 * otherwise, matching `lh trace op list`, so a dev with no session still gets
 * the goals they just ran.
 */
const listFromServer = async (limit: number, json?: boolean) => {
  const client = await getTrpcClient();
  const { data } = await client.agentTrace.listGoalTraces.query({ limit });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.length === 0) {
    log.info('No goal trajectories recorded yet.');
    return;
  }

  printTable(
    (data as GoalTraceRow[]).map((trace) => [
      trace.goalId,
      trace.finalStatus ?? pc.dim('running'),
      trace.hasTrace ? pc.green('yes') : pc.dim('—'),
      trace.advancesTotal == null ? '-' : String(trace.advancesTotal),
      formatTriggers(trace.advancesByTrigger),
      trace.startedAt ? timeAgo(trace.startedAt) : '-',
      trace.title,
    ]),
    ['GOAL', 'STATUS', 'TRACE', 'ADVANCES', 'TRIGGERS', 'AGE', 'TITLE'],
  );
};

export function registerGoalListCommand(parent: Command) {
  parent
    .command('list')
    .alias('ls')
    .description('List recorded goal trajectories (locally, or from the server)')
    .option('--server', 'List the goals recorded on the server instead of local files')
    .option('-l, --limit <n>', 'Number of goals to list', (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) throw new InvalidArgumentError('--limit must be an integer');
      return parsed;
    })
    .option('-j, --json', 'Output as JSON')
    .action(async (opts: { json?: boolean; limit?: number; server?: boolean }) => {
      const limit = opts.limit ?? DEFAULT_LIMIT;

      if (opts.server) {
        await listFromServer(limit, opts.json);
        return;
      }

      const summaries = await new FileGoalTraceStore().list({ limit });

      if (opts.json) {
        console.log(JSON.stringify(summaries, null, 2));
        return;
      }

      if (summaries.length === 0) {
        log.info(
          'No local goal trajectories in .goal-tracing/. Pass --server to list remote runs.',
        );
        return;
      }

      printTable(
        summaries.map((summary) => [
          summary.goalId,
          summary.completionReason ?? pc.dim('running'),
          String(summary.advances),
          timeAgo(new Date(summary.createdAt)),
          summary.title,
        ]),
        ['GOAL', 'STATUS', 'ADVANCES', 'AGE', 'TITLE'],
      );
    });
}
