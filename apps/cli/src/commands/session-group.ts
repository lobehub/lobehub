import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable } from '../utils/format';
import { log } from '../utils/logger';

export function registerSessionGroupCommand(program: Command) {
  const sessionGroup = program.command('session-group').description('Manage agent session groups');

  // ── list ──────────────────────────────────────────────

  sessionGroup
    .command('list')
    .description('List all session groups')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const groups = await client.sessionGroup.getSessionGroup.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(groups, fields);
        return;
      }

      if (!groups || (groups as any[]).length === 0) {
        console.log('No session groups found.');
        return;
      }

      const rows = (groups as any[]).map((g: any) => [
        g.id || '',
        g.name || '',
        String(g.sort ?? ''),
      ]);

      printTable(rows, ['ID', 'NAME', 'SORT']);
    });

  // ── create ────────────────────────────────────────────

  sessionGroup
    .command('create')
    .description('Create a session group')
    .requiredOption('-n, --name <name>', 'Group name')
    .option('-s, --sort <n>', 'Sort order')
    .action(async (options: { name: string; sort?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { name: options.name };
      if (options.sort) input.sort = Number.parseInt(options.sort, 10);

      const id = await client.sessionGroup.createSessionGroup.mutate(input as any);
      console.log(`${pc.green('✓')} Created session group ${pc.bold(String(id || ''))}`);
    });

  // ── edit ───────────────────────────────────────────────

  sessionGroup
    .command('edit <id>')
    .description('Update a session group')
    .option('-n, --name <name>', 'Group name')
    .option('-s, --sort <n>', 'Sort order')
    .action(async (id: string, options: { name?: string; sort?: string }) => {
      const value: Record<string, any> = {};
      if (options.name) value.name = options.name;
      if (options.sort) value.sort = Number.parseInt(options.sort, 10);

      if (Object.keys(value).length === 0) {
        log.error('No changes specified. Use --name or --sort.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.sessionGroup.updateSessionGroup.mutate({ id, value } as any);
      console.log(`${pc.green('✓')} Updated session group ${pc.bold(id)}`);
    });

  // ── delete ────────────────────────────────────────────

  sessionGroup
    .command('delete <id>')
    .description('Delete a session group')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this session group?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.sessionGroup.removeSessionGroup.mutate({ id });
      console.log(`${pc.green('✓')} Deleted session group ${pc.bold(id)}`);
    });

  // ── sort ──────────────────────────────────────────────

  sessionGroup
    .command('sort')
    .description('Update session group sort order')
    .requiredOption('--map <entries>', 'Comma-separated id:sort pairs (e.g. "id1:0,id2:1,id3:2")')
    .action(async (options: { map: string }) => {
      const sortMap = options.map.split(',').map((entry) => {
        const [id, sort] = entry.trim().split(':');
        if (!id || sort === undefined) {
          log.error(`Invalid sort entry: "${entry}". Use format "id:sort".`);
          process.exit(1);
        }
        return { id, sort: Number.parseInt(sort, 10) };
      });

      const client = await getTrpcClient();
      await client.sessionGroup.updateSessionGroupOrder.mutate({ sortMap });
      console.log(`${pc.green('✓')} Updated sort order for ${sortMap.length} group(s)`);
    });
}
