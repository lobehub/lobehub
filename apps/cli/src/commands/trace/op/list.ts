import {
  FileSnapshotStore,
  renderSummaryTable,
  type SnapshotSummary,
} from '@lobechat/agent-tracing';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../../api/client';
import { printTable, timeAgo } from '../../../utils/format';
import { log } from '../../../utils/logger';
import { createLocalTraceStore } from '../../../utils/traceStore';

const DEFAULT_LIMIT = 10;

/**
 * Shape of one `agentTrace.listOperations` row. Declared locally because the
 * CLI's standalone `tsc` run cannot resolve the `@/server/routers/lambda` path
 * alias, so TRPC results widen to `any` here (same reason `topic/view.ts`
 * declares its own row types).
 */
interface TopicOperation {
  createdAt: Date | string | null;
  hasTrace: boolean;
  id: string;
  model: string | null;
  status: string;
  stepCount: number | null;
}

/**
 * Server-side listing for `--topic`: turns the id a user actually has on hand
 * (a topic) into the operation ids their traces are keyed by, which previously
 * meant querying `agent_operations` by hand. `Trace` says whether a snapshot
 * exists to inspect at all — a run recorded before trace upload, or one whose
 * object has expired, has none.
 */
const listByTopic = async (topicId: string, limit: number, json?: boolean) => {
  const client = await getTrpcClient();
  const { data } = await client.agentTrace.listOperations.query({ limit, topicId });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.length === 0) {
    log.info(`No operations recorded for topic ${topicId}.`);
    return;
  }

  printTable(
    (data as TopicOperation[]).map((operation) => [
      operation.id,
      operation.status,
      operation.hasTrace ? pc.green('yes') : pc.dim('—'),
      operation.model ?? '-',
      operation.stepCount == null ? '-' : String(operation.stepCount),
      operation.createdAt ? timeAgo(operation.createdAt) : '-',
    ]),
    ['OPERATION', 'STATUS', 'TRACE', 'MODEL', 'STEPS', 'AGE'],
  );
};

const dedupeByTraceId = (summaries: SnapshotSummary[]): SnapshotSummary[] => {
  const seen = new Map<string, SnapshotSummary>();
  for (const summary of summaries)
    if (!seen.has(summary.traceId)) seen.set(summary.traceId, summary);
  return [...seen.values()];
};

export function registerOpListCommand(parent: Command) {
  parent
    .command('list')
    .alias('ls')
    .description('List recorded operation snapshots (locally, or by topic from the server)')
    .option('--topic <topicId>', 'List the operations recorded for a topic instead of local files')
    .option('-l, --limit <n>', 'Number of snapshots to list', (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) throw new InvalidArgumentError('--limit must be an integer');
      return parsed;
    })
    .option('-j, --json', 'Output as JSON')
    .action(async (opts: { json?: boolean; limit?: number; topic?: string }) => {
      const limit = opts.limit ?? DEFAULT_LIMIT;

      if (opts.topic) {
        await listByTopic(opts.topic, limit, opts.json);
        return;
      }

      // Two local stores, because two different producers write them: a
      // dev-mode server drops snapshots in `./.agent-tracing`, while locally
      // executed agent runs record to the CLI home. Listing only one of them
      // silently hides half the traces on a developer's machine.
      const [cwdSnapshots, cliHomeSnapshots] = await Promise.all([
        new FileSnapshotStore().list({ limit }),
        createLocalTraceStore().list({ limit }),
      ]);

      const summaries = dedupeByTraceId([...cwdSnapshots, ...cliHomeSnapshots])
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      console.log(opts.json ? JSON.stringify(summaries, null, 2) : renderSummaryTable(summaries));
    });
}
