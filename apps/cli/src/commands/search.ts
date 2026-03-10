import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable, truncate } from '../utils/format';

const SEARCH_TYPES = [
  'agent',
  'topic',
  'file',
  'folder',
  'message',
  'page',
  'memory',
  'mcp',
  'plugin',
  'communityAgent',
  'knowledgeBase',
] as const;

type SearchType = (typeof SEARCH_TYPES)[number];

function renderResultGroup(type: string, items: any[]) {
  if (items.length === 0) return;

  console.log();
  console.log(pc.bold(pc.cyan(`── ${type} (${items.length}) ──`)));

  const rows = items.map((item: any) => [
    item.id || '',
    truncate(item.title || item.name || item.content || 'Untitled', 80),
    item.description ? truncate(item.description, 40) : '',
  ]);

  printTable(rows, ['ID', 'TITLE', 'DESCRIPTION']);
}

export function registerSearchCommand(program: Command) {
  program
    .command('search <query>')
    .description('Search across topics, agents, files, knowledge bases, and more')
    .option('-t, --type <type>', `Filter by type: ${SEARCH_TYPES.join(', ')}`)
    .option('-L, --limit <n>', 'Results per type', '10')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        query: string,
        options: { json?: string | boolean; limit?: string; type?: string },
      ) => {
        if (options.type && !SEARCH_TYPES.includes(options.type as SearchType)) {
          console.error(
            `Invalid type: ${options.type}. Must be one of: ${SEARCH_TYPES.join(', ')}`,
          );
          process.exit(1);
        }

        const client = await getTrpcClient();

        const input: { limitPerType?: number; query: string; type?: SearchType } = { query };
        if (options.type) input.type = options.type as SearchType;
        if (options.limit) input.limitPerType = Number.parseInt(options.limit, 10);

        const result = await client.search.query.query(input);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(result, fields);
          return;
        }

        // result is expected to be an object grouped by type or an array
        if (Array.isArray(result)) {
          if (result.length === 0) {
            console.log('No results found.');
            return;
          }
          // Group by type if available
          const groups: Record<string, any[]> = {};
          for (const item of result) {
            const t = item.type || 'other';
            if (!groups[t]) groups[t] = [];
            groups[t].push(item);
          }
          for (const [type, items] of Object.entries(groups)) {
            renderResultGroup(type, items);
          }
        } else if (result && typeof result === 'object') {
          const groups = result as Record<string, any[]>;
          let hasResults = false;
          for (const [type, items] of Object.entries(groups)) {
            if (Array.isArray(items) && items.length > 0) {
              hasResults = true;
              renderResultGroup(type, items);
            }
          }
          if (!hasResults) {
            console.log('No results found.');
          }
        }
      },
    );
}
