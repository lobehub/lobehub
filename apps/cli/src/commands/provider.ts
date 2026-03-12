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

      if (!result || !(result as any).id) {
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
      console.log(pc.bold(r.name || r.id));
      const meta: string[] = [];
      if (r.enabled !== undefined) meta.push(r.enabled ? 'Enabled' : 'Disabled');
      if (r.source) meta.push(`Source: ${r.source}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));
    });

  // ── create ────────────────────────────────────────────

  provider
    .command('create')
    .description('Create a new AI provider')
    .requiredOption('--id <id>', 'Provider ID')
    .requiredOption('-n, --name <name>', 'Provider name')
    .option('-s, --source <source>', 'Source type (builtin|custom)', 'custom')
    .option('-d, --description <desc>', 'Provider description')
    .option('--logo <logo>', 'Provider logo URL')
    .option('--sdk-type <sdkType>', 'SDK type (openai|anthropic|azure|bedrock|...)')
    .action(
      async (options: {
        description?: string;
        id: string;
        logo?: string;
        name: string;
        sdkType?: string;
        source?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          id: options.id,
          name: options.name,
          source: options.source || 'custom',
        };
        if (options.description) input.description = options.description;
        if (options.logo) input.logo = options.logo;
        if (options.sdkType) input.sdkType = options.sdkType;

        const resultId = await client.aiProvider.createAiProvider.mutate(input as any);
        console.log(`${pc.green('✓')} Created provider ${pc.bold(resultId || options.id)}`);
      },
    );

  // ── edit ─────────────────────────────────────────────

  provider
    .command('edit <id>')
    .description('Update provider info')
    .option('-n, --name <name>', 'Provider name')
    .option('-d, --description <desc>', 'Provider description')
    .option('--logo <logo>', 'Provider logo URL')
    .option('--sdk-type <sdkType>', 'SDK type')
    .action(
      async (
        id: string,
        options: { description?: string; logo?: string; name?: string; sdkType?: string },
      ) => {
        if (!options.name && !options.description && !options.logo && !options.sdkType) {
          log.error('No changes specified. Use --name, --description, --logo, or --sdk-type.');
          process.exit(1);
        }

        const client = await getTrpcClient();

        const value: Record<string, any> = {};
        if (options.name) value.name = options.name;
        if (options.description !== undefined) value.description = options.description;
        if (options.logo !== undefined) value.logo = options.logo;
        if (options.sdkType) value.sdkType = options.sdkType;

        await client.aiProvider.updateAiProvider.mutate({ id, value: value as any });
        console.log(`${pc.green('✓')} Updated provider ${pc.bold(id)}`);
      },
    );

  // ── config ──────────────────────────────────────────

  provider
    .command('config <id>')
    .description('Configure provider settings (API key, base URL, etc.)')
    .option('--api-key <key>', 'Set API key')
    .option('--base-url <url>', 'Set base URL')
    .option('--check-model <model>', 'Set connectivity check model')
    .option('--enable-response-api', 'Enable Response API mode (OpenAI)')
    .option('--disable-response-api', 'Disable Response API mode')
    .option('--fetch-on-client', 'Enable fetching models on client side')
    .option('--no-fetch-on-client', 'Disable fetching models on client side')
    .option('--show', 'Show current config')
    .option('--json [fields]', 'Output JSON (with --show)')
    .action(
      async (
        id: string,
        options: {
          apiKey?: string;
          baseUrl?: string;
          checkModel?: string;
          disableResponseApi?: boolean;
          enableResponseApi?: boolean;
          fetchOnClient?: boolean;
          json?: string | boolean;
          show?: boolean;
        },
      ) => {
        // lobehub is a platform-managed provider, users cannot configure its API key or base URL
        if (id === 'lobehub' && (options.apiKey !== undefined || options.baseUrl !== undefined)) {
          log.error(
            `Provider "lobehub" is managed by the LobeHub platform. You cannot set --api-key or --base-url for it.`,
          );
          process.exit(1);
        }

        const client = await getTrpcClient();

        // Show current config
        if (options.show) {
          const detail = await client.aiProvider.getAiProviderById.query({ id });
          if (!detail) {
            log.error(`Provider not found: ${id}`);
            process.exit(1);
            return;
          }

          const config: Record<string, any> = {
            checkModel: (detail as any).checkModel || '',
            fetchOnClient: (detail as any).fetchOnClient ?? false,
            keyVaults: (detail as any).keyVaults || {},
          };

          if (options.json !== undefined) {
            const fields = typeof options.json === 'string' ? options.json : undefined;
            outputJson(config, fields);
          } else {
            console.log(pc.bold(`Config for ${id}`));
            if (config.checkModel) console.log(`  Check Model: ${config.checkModel}`);
            console.log(`  Fetch on Client: ${config.fetchOnClient ? pc.green('✓') : pc.dim('✗')}`);
            const vaults = config.keyVaults;
            if (vaults.apiKey)
              console.log(`  API Key: ${pc.dim(vaults.apiKey.slice(0, 8) + '...')}`);
            if (vaults.baseURL) console.log(`  Base URL: ${vaults.baseURL}`);
          }
          return;
        }

        // Build config update
        const hasKeyVaults = options.apiKey !== undefined || options.baseUrl !== undefined;
        const hasConfig = options.enableResponseApi || options.disableResponseApi;
        const hasOther = options.checkModel !== undefined || options.fetchOnClient !== undefined;

        if (!hasKeyVaults && !hasConfig && !hasOther) {
          log.error(
            'No config specified. Use --api-key, --base-url, --check-model, --enable-response-api, --fetch-on-client, or --show.',
          );
          process.exit(1);
        }

        const input: Record<string, any> = {};

        if (hasKeyVaults) {
          const keyVaults: Record<string, string> = {};
          if (options.apiKey !== undefined) keyVaults.apiKey = options.apiKey;
          if (options.baseUrl !== undefined) keyVaults.baseURL = options.baseUrl;
          input.keyVaults = keyVaults;
        }

        if (hasConfig) {
          input.config = { enableResponseApi: !!options.enableResponseApi };
        }

        if (options.checkModel !== undefined) input.checkModel = options.checkModel;
        if (options.fetchOnClient !== undefined) input.fetchOnClient = options.fetchOnClient;

        await client.aiProvider.updateAiProviderConfig.mutate({ id, value: input as any });
        console.log(`${pc.green('✓')} Updated config for provider ${pc.bold(id)}`);
      },
    );

  // ── test ─────────────────────────────────────────────

  provider
    .command('test <id>')
    .description('Test provider connectivity')
    .option('-m, --model <model>', 'Model to test with (defaults to provider checkModel)')
    .option('--json', 'Output result as JSON')
    .action(async (id: string, options: { json?: boolean; model?: string }) => {
      const client = await getTrpcClient();

      console.log(`${pc.yellow('⋯')} Testing provider ${pc.bold(id)}...`);

      const result = (await client.aiProvider.checkProviderConnectivity.mutate({
        id,
        model: options.model,
      })) as any;

      if (options.json) {
        outputJson(result);
        return;
      }

      if (result.ok) {
        console.log(
          `${pc.green('✓')} Provider ${pc.bold(id)} is reachable (model: ${result.model})`,
        );
      } else {
        console.log(`${pc.red('✗')} Provider ${pc.bold(id)} check failed`);
        if (result.model) console.log(`  Model: ${result.model}`);
        if (result.error) console.log(`  Error: ${pc.dim(result.error)}`);
        process.exit(1);
      }
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
