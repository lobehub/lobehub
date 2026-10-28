// A CLI prints a list response as JSON. Nothing in this file shows a credential field
// in that payload, so "if it carries an API key" is speculation.
import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable } from '../utils/format';

export function registerProviderList(program: Command) {
  program
    .command('list')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.aiProvider.getAiProviderList.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        outputJson(items, typeof options.json === 'string' ? options.json : undefined);
        return;
      }

      printTable(
        items.map((p: any) => [p.id || '', p.name || p.id || '', p.enabled ? 'yes' : 'no']),
        ['ID', 'NAME', 'ENABLED'],
      );
    });
}
