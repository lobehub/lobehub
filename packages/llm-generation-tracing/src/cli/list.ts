import type { Command } from 'commander';

import { FileTracingStore } from '../store/file-store';
import { renderSummaryTable } from '../viewer';

export function registerListCommand(program: Command) {
  program
    .command('list')
    .alias('ls')
    .description('List recent llm-generation-tracing records (newest first)')
    .option('-l, --limit <n>', 'Max number of records to show', '20')
    .option('-s, --scenario <name>', 'Filter by scenario (e.g. input_completion, topic_title)')
    .option('-j, --json', 'Output as JSON instead of a table')
    .action(async (opts: { json?: boolean; limit: string; scenario?: string }) => {
      const store = new FileTracingStore();
      let limit = Number.parseInt(opts.limit, 10);
      if (Number.isNaN(limit) || limit < 1) limit = 20;
      const summaries = await store.list({ limit, scenario: opts.scenario });
      console.info(opts.json ? JSON.stringify(summaries, null, 2) : renderSummaryTable(summaries));
    });
}
