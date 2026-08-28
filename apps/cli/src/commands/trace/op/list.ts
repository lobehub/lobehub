import { FileSnapshotStore, renderSummaryTable } from '@lobechat/agent-tracing';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';

export function registerOpListCommand(parent: Command) {
  parent
    .command('list')
    .alias('ls')
    .description('List locally recorded operation snapshots')
    .option('-l, --limit <n>', 'Number of snapshots to list', (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) throw new InvalidArgumentError('--limit must be an integer');
      return parsed;
    })
    .option('-j, --json', 'Output as JSON')
    .action(async (opts: { json?: boolean; limit?: number }) => {
      const summaries = await new FileSnapshotStore().list({ limit: opts.limit ?? 10 });

      console.log(opts.json ? JSON.stringify(summaries, null, 2) : renderSummaryTable(summaries));
    });
}
