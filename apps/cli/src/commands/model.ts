import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerModelCommand(program: Command) {
  const model = program.command('model').description('Manage AI models');

  // ── list ──────────────────────────────────────────────

  model
    .command('list <providerId>')
    .description('List models for a provider')
    .option('-L, --limit <n>', 'Maximum number of items', '50')
    .option('--enabled', 'Only show enabled models')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        providerId: string,
        options: { enabled?: boolean; json?: string | boolean; limit?: string },
      ) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = { id: providerId };
        if (options.limit) input.limit = Number.parseInt(options.limit, 10);
        if (options.enabled) input.enabled = true;

        const result = await client.aiModel.getAiProviderModelList.query(input as any);
        const items = Array.isArray(result) ? result : ((result as any).items ?? []);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(items, fields);
          return;
        }

        if (items.length === 0) {
          console.log('No models found.');
          return;
        }

        const rows = items.map((m: any) => [
          m.id || '',
          truncate(m.displayName || m.id || '', 40),
          m.enabled ? pc.green('✓') : pc.dim('✗'),
          m.type || '',
        ]);

        printTable(rows, ['ID', 'NAME', 'ENABLED', 'TYPE']);
      },
    );

  // ── view ──────────────────────────────────────────────

  model
    .command('view <id>')
    .description('View model details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.aiModel.getAiModelById.query({ id });

      if (!result) {
        log.error(`Model not found: ${id}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      console.log(pc.bold(r.displayName || r.id || 'Unknown'));
      const meta: string[] = [];
      if (r.providerId) meta.push(`Provider: ${r.providerId}`);
      if (r.type) meta.push(`Type: ${r.type}`);
      if (r.enabled !== undefined) meta.push(r.enabled ? 'Enabled' : 'Disabled');
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));
    });

  // ── toggle ────────────────────────────────────────────

  model
    .command('toggle <id>')
    .description('Enable or disable a model')
    .requiredOption('--provider <providerId>', 'Provider ID')
    .option('--enable', 'Enable the model')
    .option('--disable', 'Disable the model')
    .action(
      async (id: string, options: { disable?: boolean; enable?: boolean; provider: string }) => {
        if (options.enable === undefined && options.disable === undefined) {
          log.error('Specify --enable or --disable.');
          process.exit(1);
        }

        const client = await getTrpcClient();
        const enabled = options.enable === true;

        await client.aiModel.toggleModelEnabled.mutate({
          enabled,
          id,
          providerId: options.provider,
        } as any);
        console.log(`${pc.green('✓')} Model ${pc.bold(id)} ${enabled ? 'enabled' : 'disabled'}`);
      },
    );

  // ── delete ────────────────────────────────────────────

  model
    .command('delete <id>')
    .description('Delete a model')
    .requiredOption('--provider <providerId>', 'Provider ID')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { provider: string; yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this model?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.aiModel.removeAiModel.mutate({ id, providerId: options.provider });
      console.log(`${pc.green('✓')} Deleted model ${pc.bold(id)}`);
    });
}
