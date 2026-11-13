import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerLegacyPluginCommand(program: Command) {
  const plugin = program
    .command('legacy-plugin')
    .alias('plugin')
    .description(
      'Manage legacy 1.0 plugins (user_installed_plugins). Add new MCP servers with lh connector add',
    );

  // ── list ──────────────────────────────────────────────

  plugin
    .command('list')
    .description('List installed plugins')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.plugin.getPlugins.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No plugins installed.');
        return;
      }

      const rows = items.map((p: any) => [
        p.id || '',
        truncate(p.identifier || '', 30),
        p.type || '',
        truncate(p.manifest?.meta?.title || p.manifest?.identifier || '', 30),
      ]);

      printTable(rows, ['ID', 'IDENTIFIER', 'TYPE', 'TITLE']);
    });

  // ── search ────────────────────────────────────────────

  plugin
    .command('search [query]')
    .description('Search MCP plugins in the marketplace')
    .option('-c, --category <category>', 'Filter by category (e.g. developer, productivity)')
    .option('-L, --limit <n>', 'Number of results', '20')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        query: string | undefined,
        options: { category?: string; json?: string | boolean; limit?: string },
      ) => {
        const client = await getTrpcClient();
        const [result, installed] = await Promise.all([
          client.market.getMcpList.query({
            category: options.category,
            pageSize: Number.parseInt(options.limit || '20', 10),
            q: query,
          }),
          client.plugin.getPlugins.query(),
        ]);
        const installedIds = new Set(
          (Array.isArray(installed) ? installed : []).map((p: any) => p.identifier),
        );
        const items = (result?.items ?? []).map((item: any) => ({
          ...item,
          installed: installedIds.has(item.identifier),
        }));

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(items, fields);
          return;
        }

        if (items.length === 0) {
          console.log('No plugins found.');
          return;
        }

        const rows = items.map((p: any) => [
          truncate(p.identifier || '', 30),
          truncate(p.name || '', 30),
          truncate(p.description || '', 50),
          p.installed ? pc.green('installed') : '',
        ]);

        printTable(rows, ['IDENTIFIER', 'NAME', 'DESCRIPTION', 'STATUS']);
        if (result?.totalCount > items.length) {
          console.log(pc.dim(`Showing ${items.length} of ${result.totalCount} results.`));
        }
      },
    );

  // ── uninstall ─────────────────────────────────────────

  plugin
    .command('uninstall <id>')
    .description('Uninstall a plugin')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to uninstall this plugin?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.plugin.removePlugin.mutate({ id });
      console.log(`${pc.green('✓')} Uninstalled plugin ${pc.bold(id)}`);
    });

  // ── update ────────────────────────────────────────────

  plugin
    .command('update <id>')
    .description('Update plugin settings or manifest')
    .option('--manifest <json>', 'New manifest JSON')
    .option('--settings <json>', 'New settings JSON')
    .action(async (id: string, options: { manifest?: string; settings?: string }) => {
      const input: Record<string, any> = { id };

      if (options.manifest) {
        try {
          input.manifest = JSON.parse(options.manifest);
        } catch {
          log.error('Invalid manifest JSON.');
          process.exit(1);
        }
      }
      if (options.settings) {
        try {
          input.settings = JSON.parse(options.settings);
        } catch {
          log.error('Invalid settings JSON.');
          process.exit(1);
        }
      }

      if (!options.manifest && !options.settings) {
        log.error('No changes specified. Use --manifest or --settings.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.plugin.updatePlugin.mutate(input as any);
      console.log(`${pc.green('✓')} Updated plugin ${pc.bold(id)}`);
    });
}
