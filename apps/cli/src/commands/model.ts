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
    .option(
      '--type <type>',
      'Filter by model type (chat|embedding|tts|stt|image|video|text2music|realtime)',
    )
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        providerId: string,
        options: { enabled?: boolean; json?: string | boolean; limit?: string; type?: string },
      ) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = { id: providerId };
        if (options.limit) input.limit = Number.parseInt(options.limit, 10);
        if (options.enabled) input.enabled = true;
        if (options.type) input.type = options.type;

        const result = await client.aiModel.getAiProviderModelList.query(input as any);
        let items = Array.isArray(result) ? result : ((result as any).items ?? []);

        if (options.type) {
          items = items.filter((m: any) => m.type === options.type);
        }

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

  // ── create ────────────────────────────────────────────

  model
    .command('create')
    .description('Create a new model')
    .requiredOption('--id <id>', 'Model ID')
    .requiredOption('--provider <providerId>', 'Provider ID')
    .option('--display-name <name>', 'Display name')
    .option(
      '--type <type>',
      'Model type (chat|embedding|tts|stt|image|video|text2music|realtime)',
      'chat',
    )
    .action(
      async (options: { displayName?: string; id: string; provider: string; type?: string }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          id: options.id,
          providerId: options.provider,
          type: options.type || 'chat',
        };
        if (options.displayName) input.displayName = options.displayName;

        const resultId = await client.aiModel.createAiModel.mutate(input as any);
        console.log(`${pc.green('✓')} Created model ${pc.bold(resultId || options.id)}`);
      },
    );

  // ── edit ─────────────────────────────────────────────

  model
    .command('edit <id>')
    .description('Update model info')
    .requiredOption('--provider <providerId>', 'Provider ID')
    .option('--display-name <name>', 'Display name')
    .option('--type <type>', 'Model type (chat|embedding|tts|stt|image|video|text2music|realtime)')
    .action(
      async (id: string, options: { displayName?: string; provider: string; type?: string }) => {
        if (!options.displayName && !options.type) {
          log.error('No changes specified. Use --display-name or --type.');
          process.exit(1);
        }

        const client = await getTrpcClient();

        const value: Record<string, any> = {};
        if (options.displayName) value.displayName = options.displayName;
        if (options.type) value.type = options.type;

        await client.aiModel.updateAiModel.mutate({
          id,
          providerId: options.provider,
          value: value as any,
        });
        console.log(`${pc.green('✓')} Updated model ${pc.bold(id)}`);
      },
    );

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

  // ── batch-toggle ────────────────────────────────────

  model
    .command('batch-toggle <ids...>')
    .description('Enable or disable multiple models at once')
    .requiredOption('--provider <providerId>', 'Provider ID')
    .option('--enable', 'Enable the models')
    .option('--disable', 'Disable the models')
    .action(
      async (ids: string[], options: { disable?: boolean; enable?: boolean; provider: string }) => {
        if (options.enable === undefined && options.disable === undefined) {
          log.error('Specify --enable or --disable.');
          process.exit(1);
        }

        const client = await getTrpcClient();
        const enabled = options.enable === true;

        await client.aiModel.batchToggleAiModels.mutate({
          enabled,
          id: options.provider,
          models: ids,
        } as any);
        console.log(
          `${pc.green('✓')} ${enabled ? 'Enabled' : 'Disabled'} ${ids.length} model(s) for provider ${pc.bold(options.provider)}`,
        );
      },
    );

  // ── batch-update ──────────────────────────────────────

  model
    .command('batch-update <providerId>')
    .description('Batch update models for a provider')
    .requiredOption('--models <json>', 'JSON array of model objects')
    .action(async (providerId: string, options: { models: string }) => {
      let models: any[];
      try {
        models = JSON.parse(options.models);
      } catch {
        log.error('Invalid models JSON. Provide a JSON array.');
        process.exit(1);
        return;
      }

      if (!Array.isArray(models)) {
        log.error('--models must be a JSON array.');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      await client.aiModel.batchUpdateAiModels.mutate({ id: providerId, models } as any);
      console.log(
        `${pc.green('✓')} Batch updated ${models.length} model(s) for provider ${pc.bold(providerId)}`,
      );
    });

  // ── sort ──────────────────────────────────────────────

  model
    .command('sort <providerId>')
    .description('Update model sort order')
    .requiredOption('--sort-map <json>', 'JSON array of {id, sort, type?} objects')
    .action(async (providerId: string, options: { sortMap: string }) => {
      let sortMap: any[];
      try {
        sortMap = JSON.parse(options.sortMap);
      } catch {
        log.error('Invalid sort-map JSON. Provide a JSON array.');
        process.exit(1);
        return;
      }

      if (!Array.isArray(sortMap)) {
        log.error('--sort-map must be a JSON array.');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      await client.aiModel.updateAiModelOrder.mutate({ providerId, sortMap } as any);
      console.log(
        `${pc.green('✓')} Updated sort order for ${sortMap.length} model(s) in provider ${pc.bold(providerId)}`,
      );
    });

  // ── clear ───────────────────────────────────────────

  model
    .command('clear')
    .description('Clear models for a provider')
    .requiredOption('--provider <providerId>', 'Provider ID')
    .option('--remote', 'Only clear remote/fetched models')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (options: { provider: string; remote?: boolean; yes?: boolean }) => {
      const label = options.remote ? 'remote models' : 'all models';
      if (!options.yes) {
        const confirmed = await confirm(
          `Are you sure you want to clear ${label} for provider ${options.provider}?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      if (options.remote) {
        await client.aiModel.clearRemoteModels.mutate({ providerId: options.provider } as any);
      } else {
        await client.aiModel.clearModelsByProvider.mutate({ providerId: options.provider } as any);
      }
      console.log(`${pc.green('✓')} Cleared ${label} for provider ${pc.bold(options.provider)}`);
    });
}
