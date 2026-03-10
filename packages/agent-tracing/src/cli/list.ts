import type { Command } from 'commander';

import { FileSnapshotStore } from '../store/file-store';
import { renderSummaryTable } from '../viewer';

export function registerListCommand(program: Command) {
  program
    .command('list')
    .description('List recent snapshots')
    .option('-l, --limit <n>', 'Max number of snapshots to show', '10')
    .action(async (opts: { limit: string }) => {
      const store = new FileSnapshotStore();
      let limit = Number.parseInt(opts.limit, 10);
      if (Number.isNaN(limit) || limit < 1) limit = 10;
      console.log(renderSummaryTable(await store.list({ limit })));
    });
}
