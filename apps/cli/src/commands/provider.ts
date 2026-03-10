import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerProviderCommand(program: Command) {
  const provider = program.command('provider').description('Manage AI providers');

  // ── list ──────────────────────────────────────────────

  provider
    .command('list')
    .description('List AI providers')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.aiProvider.getAiProviderList.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No providers found.');
        return;
      }

      const rows = items.map((p: any) => [
        p.id || '',
        truncate(p.name || p.id || '', 30),
        p.enabled ? pc.green('✓') : pc.dim('✗'),
        p.source || '',
      ]);

      printTable(rows, ['ID', 'NAME', 'ENABLED', 'SOURCE']);
    });

  // ── view ──────────────────────────────────────────────

  provider
    .command('view <id>')
    .description('View provider details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.aiProvider.getAiProviderById.query({ id });

      if (!result) {
        log.error(`Provider not found: ${id}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      console.log(pc.bold(r.name || r.id || 'Unknown'));
      const meta: string[] = [];
      if (r.enabled !== undefined) meta.push(r.enabled ? 'Enabled' : 'Disabled');
      if (r.source) meta.push(`Source: ${r.source}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));
    });

  // ── toggle ────────────────────────────────────────────

  provider
    .command('toggle <id>')
    .description('Enable or disable a provider')
    .option('--enable', 'Enable the provider')
    .option('--disable', 'Disable the provider')
    .action(async (id: string, options: { disable?: boolean; enable?: boolean }) => {
      if (options.enable === undefined && options.disable === undefined) {
        log.error('Specify --enable or --disable.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      const enabled = options.enable === true;

      await client.aiProvider.toggleProviderEnabled.mutate({ enabled, id });
      console.log(`${pc.green('✓')} Provider ${pc.bold(id)} ${enabled ? 'enabled' : 'disabled'}`);
    });

  // ── delete ────────────────────────────────────────────

  provider
    .command('delete <id>')
    .description('Delete a provider')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this provider?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.aiProvider.removeAiProvider.mutate({ id });
      console.log(`${pc.green('✓')} Deleted provider ${pc.bold(id)}`);
    });
}
