import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerPluginCommand(program: Command) {
  const plugin = program.command('plugin').description('Manage plugins');

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

  // ── install ───────────────────────────────────────────

  plugin
    .command('install')
    .description('Install a plugin')
    .requiredOption('-i, --identifier <id>', 'Plugin identifier')
    .requiredOption('--manifest <json>', 'Plugin manifest JSON')
    .option('--type <type>', 'Plugin type: plugin or customPlugin', 'plugin')
    .option('--settings <json>', 'Plugin settings JSON')
    .action(
      async (options: {
        identifier: string;
        manifest: string;
        settings?: string;
        type: string;
      }) => {
        const client = await getTrpcClient();

        let manifest: any;
        let settings: any;
        try {
          manifest = JSON.parse(options.manifest);
        } catch {
          log.error('Invalid manifest JSON.');
          process.exit(1);
        }
        if (options.settings) {
          try {
            settings = JSON.parse(options.settings);
          } catch {
            log.error('Invalid settings JSON.');
            process.exit(1);
          }
        }

        await client.plugin.createOrInstallPlugin.mutate({
          customParams: {},
          identifier: options.identifier,
          manifest,
          settings,
          type: options.type as 'plugin' | 'customPlugin',
        });

        console.log(`${pc.green('✓')} Installed plugin ${pc.bold(options.identifier)}`);
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
