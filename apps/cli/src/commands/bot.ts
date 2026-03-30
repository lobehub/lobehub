import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../api/client';
import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printBoxTable, printTable, timeAgo } from '../utils/format';
import { log } from '../utils/logger';
import { registerBotMessageCommands } from './botMessage';

// ── Helpers ──────────────────────────────────────────────

function maskValue(val: string): string {
  if (val.length > 8) return val.slice(0, 4) + '****' + val.slice(-4);
  return '****';
}

function camelToFlag(name: string): string {
  return '--' + name.replaceAll(/([A-Z])/g, '-$1').toLowerCase();
}

/** Extract credential field definitions from a platform schema. */
function getCredentialFields(platformDef: any): any[] {
  const credSchema = (platformDef.schema ?? []).find(
    (f: any) => f.key === 'credentials' && f.properties,
  );
  return credSchema?.properties ?? [];
}

/** Extract credential values from CLI options based on platform schema. */
function extractCredentials(
  platformDef: any,
  options: Record<string, any>,
): { credentials: Record<string, string>; missing: any[] } {
  const fields = getCredentialFields(platformDef);
  const credentials: Record<string, string> = {};

  for (const field of fields) {
    const value = options[field.key];
    if (typeof value === 'string') {
      credentials[field.key] = value;
    }
  }

  const missing = fields.filter((f: any) => f.required && !credentials[f.key]);
  return { credentials, missing };
}

/** Find a bot by ID from the user's bot list. */
async function findBot(client: TrpcClient, botId: string) {
  const bots = await client.agentBotProvider.list.query();
  const bot = (bots as any[]).find((b: any) => b.id === botId);
  if (!bot) {
    log.error(`Bot integration not found: ${botId}`);
    process.exit(1);
  }
  return bot;
}

const STATUS_COLORS: Record<string, (s: string) => string> = {
  connected: pc.green,
  disconnected: pc.dim,
  failed: pc.red,
  queued: pc.yellow,
  starting: pc.yellow,
  unknown: pc.dim,
};

/** Validate a platform ID and return its definition. */
async function resolvePlatform(client: TrpcClient, platformId: string) {
  const platforms = await client.agentBotProvider.listPlatforms.query();
  const def = (platforms as any[]).find((p: any) => p.id === platformId);
  if (!def) {
    const ids = (platforms as any[]).map((p: any) => p.id).join(', ');
    log.error(`Invalid platform "${platformId}". Must be one of: ${ids}`);
    log.info('Run `lh bot platforms` to see required credentials for each platform.');
    process.exit(1);
  }
  return def;
}

// ── Command Registration ─────────────────────────────────

export function registerBotCommand(program: Command) {
  const bot = program.command('bot').description('Manage bot integrations');

  // Register message subcommand group
  registerBotMessageCommands(bot);

  // ── platforms ───────────────────────────────────────────

  bot
    .command('platforms')
    .description('List supported platforms and their required credentials')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const platforms = await client.agentBotProvider.listPlatforms.query();

      if (options.json) {
        outputJson(platforms);
        return;
      }

      console.log(pc.bold('Supported platforms:\n'));

      for (const p of platforms as any[]) {
        console.log(`  ${pc.bold(pc.cyan(p.id))}`);
        if (p.name) console.log(`    Name: ${p.name}`);

        const fields = getCredentialFields(p);
        const required = fields.filter((f: any) => f.required);
        const optional = fields.filter((f: any) => !f.required);

        if (required.length > 0) {
          console.log(
            `    Required: ${required.map((f: any) => pc.yellow(camelToFlag(f.key))).join(', ')}`,
          );
        }
        if (optional.length > 0) {
          console.log(
            `    Optional: ${optional.map((f: any) => pc.dim(camelToFlag(f.key))).join(', ')}`,
          );
        }
        console.log();
      }
    });

  // ── list ──────────────────────────────────────────────

  bot
    .command('list')
    .description('List bot integrations')
    .option('-a, --agent <agentId>', 'Filter by agent ID')
    .option('--platform <platform>', 'Filter by platform')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { agent?: string; json?: string | boolean; platform?: string }) => {
      const client = await getTrpcClient();

      const input: { agentId?: string; platform?: string } = {};
      if (options.agent) input.agentId = options.agent;
      if (options.platform) input.platform = options.platform;

      const result = await client.agentBotProvider.list.query(input);
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No bot integrations found.');
        return;
      }

      const rows = items.map((b: any) => {
        const status = b.enabled ? (b.runtimeStatus ?? 'disconnected') : 'disabled';
        const colorFn = STATUS_COLORS[status] ?? pc.dim;
        return [
          b.id || '',
          b.platform || '',
          b.applicationId || '',
          b.agentId || '',
          colorFn(status),
          b.updatedAt ? timeAgo(b.updatedAt) : pc.dim('-'),
        ];
      });

      printTable(rows, ['ID', 'PLATFORM', 'APP ID', 'AGENT', 'STATUS', 'UPDATED']);
    });

  // ── view ──────────────────────────────────────────────

  bot
    .command('view <botId>')
    .description('View bot integration details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .option('--show-credentials', 'Show full credential values (unmasked)')
    .action(
      async (botId: string, options: { json?: string | boolean; showCredentials?: boolean }) => {
        const client = await getTrpcClient();
        const b = await findBot(client, botId);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(b, fields);
          return;
        }

        const status = b.enabled ? (b.runtimeStatus ?? 'disconnected') : 'disabled';
        const statusColorFn = STATUS_COLORS[status] ?? pc.dim;

        const credentialLines: string[] = [];
        if (b.credentials && typeof b.credentials === 'object') {
          for (const [key, value] of Object.entries(b.credentials)) {
            const val = String(value);
            const display = options.showCredentials ? val : maskValue(val);
            credentialLines.push(`${pc.dim(key)}: ${display}`);
          }
        }

        const settingsLines: string[] = [];
        if (b.settings && typeof b.settings === 'object') {
          for (const [key, value] of Object.entries(b.settings)) {
            settingsLines.push(`${pc.dim(key)}: ${JSON.stringify(value)}`);
          }
        }

        printBoxTable(
          [
            { header: 'Field', key: 'field' },
            { header: 'Value', key: 'value' },
          ],
          [
            { field: 'ID', value: b.id || '' },
            { field: 'Platform', value: pc.cyan(b.platform || '') },
            { field: 'Application ID', value: b.applicationId || '' },
            { field: 'Agent ID', value: b.agentId || '' },
            { field: 'Status', value: statusColorFn(status) },
            ...(credentialLines.length > 0
              ? [{ field: 'Credentials', value: credentialLines }]
              : []),
            ...(settingsLines.length > 0 ? [{ field: 'Settings', value: settingsLines }] : []),
            ...(b.createdAt
              ? [{ field: 'Created', value: new Date(b.createdAt).toLocaleString() }]
              : []),
            ...(b.updatedAt ? [{ field: 'Updated', value: timeAgo(b.updatedAt) }] : []),
          ],
          `${b.platform} bot`,
        );
      },
    );

  // ── add ───────────────────────────────────────────────

  bot
    .command('add')
    .description('Add a bot integration to an agent')
    .requiredOption('-a, --agent <agentId>', 'Agent ID')
    .requiredOption('--platform <platform>', 'Platform (run `lh bot platforms` to see options)')
    .requiredOption('--app-id <appId>', 'Application ID for webhook routing')
    .option('--bot-token <token>', 'Bot token (Discord, Slack, Telegram)')
    .option('--bot-id <id>', 'Bot ID (WeChat)')
    .option('--public-key <key>', 'Public key (Discord)')
    .option('--signing-secret <secret>', 'Signing secret (Slack)')
    .option('--app-secret <secret>', 'App secret (Lark, Feishu, QQ)')
    .option('--secret-token <token>', 'Secret token (Telegram)')
    .option('--webhook-proxy-url <url>', 'Webhook proxy URL (Telegram)')
    .option('--encrypt-key <key>', 'Encrypt key (Feishu)')
    .option('--verification-token <token>', 'Verification token (Feishu)')
    .option('--json', 'Output created bot as JSON')
    .action(
      async (options: {
        agent: string;
        appId: string;
        appSecret?: string;
        botId?: string;
        botToken?: string;
        encryptKey?: string;
        json?: boolean;
        platform: string;
        publicKey?: string;
        secretToken?: string;
        signingSecret?: string;
        verificationToken?: string;
        webhookProxyUrl?: string;
      }) => {
        const client = await getTrpcClient();
        const platformDef = await resolvePlatform(client, options.platform);

        const { credentials, missing } = extractCredentials(platformDef, options);
        if (missing.length > 0) {
          log.error(
            `Missing required credentials for ${options.platform}: ${missing.map((f: any) => camelToFlag(f.key)).join(', ')}`,
          );
          process.exit(1);
          return;
        }

        const result = await client.agentBotProvider.create.mutate({
          agentId: options.agent,
          applicationId: options.appId,
          credentials,
          platform: options.platform,
        });

        if (options.json) {
          outputJson(result);
          return;
        }

        const r = result as any;
        console.log(
          `${pc.green('✓')} Added ${pc.bold(options.platform)} bot ${pc.bold(r.id || '')}`,
        );
      },
    );

  // ── update ────────────────────────────────────────────

  bot
    .command('update <botId>')
    .description('Update a bot integration')
    .option('--bot-token <token>', 'New bot token')
    .option('--bot-id <id>', 'New bot ID (WeChat)')
    .option('--public-key <key>', 'New public key')
    .option('--signing-secret <secret>', 'New signing secret')
    .option('--app-secret <secret>', 'New app secret')
    .option('--secret-token <token>', 'New secret token')
    .option('--webhook-proxy-url <url>', 'New webhook proxy URL')
    .option('--encrypt-key <key>', 'New encrypt key')
    .option('--verification-token <token>', 'New verification token')
    .option('--app-id <appId>', 'New application ID')
    .option('--platform <platform>', 'New platform')
    .action(
      async (
        botId: string,
        options: {
          appId?: string;
          appSecret?: string;
          botId?: string;
          botToken?: string;
          encryptKey?: string;
          platform?: string;
          publicKey?: string;
          secretToken?: string;
          signingSecret?: string;
          verificationToken?: string;
          webhookProxyUrl?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const input: Record<string, any> = { id: botId };

        const existing = await findBot(client, botId);
        const platform = options.platform ?? existing.platform;
        const platformDef = await resolvePlatform(client, platform);

        const { credentials } = extractCredentials(platformDef, options);
        if (Object.keys(credentials).length > 0) input.credentials = credentials;
        if (options.appId) input.applicationId = options.appId;
        if (options.platform) input.platform = options.platform;

        if (Object.keys(input).length <= 1) {
          log.error('No changes specified.');
          process.exit(1);
          return;
        }

        await client.agentBotProvider.update.mutate(input as any);
        console.log(`${pc.green('✓')} Updated bot ${pc.bold(botId)}`);
      },
    );

  // ── remove ────────────────────────────────────────────

  bot
    .command('remove <botId>')
    .description('Remove a bot integration')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (botId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to remove this bot integration?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.agentBotProvider.delete.mutate({ id: botId });
      console.log(`${pc.green('✓')} Removed bot ${pc.bold(botId)}`);
    });

  // ── enable / disable ──────────────────────────────────

  bot
    .command('enable <botId>')
    .description('Enable a bot integration')
    .action(async (botId: string) => {
      const client = await getTrpcClient();
      await client.agentBotProvider.update.mutate({ enabled: true, id: botId } as any);
      console.log(`${pc.green('✓')} Enabled bot ${pc.bold(botId)}`);
    });

  bot
    .command('disable <botId>')
    .description('Disable a bot integration')
    .action(async (botId: string) => {
      const client = await getTrpcClient();
      await client.agentBotProvider.update.mutate({ enabled: false, id: botId } as any);
      console.log(`${pc.green('✓')} Disabled bot ${pc.bold(botId)}`);
    });

  // ── test ───────────────────────────────────────────────

  bot
    .command('test <botId>')
    .description('Test bot credentials against the platform API')
    .action(async (botId: string) => {
      const client = await getTrpcClient();
      const b = await findBot(client, botId);

      log.status(`Testing ${b.platform} credentials for ${b.applicationId}...`);

      try {
        await client.agentBotProvider.testConnection.mutate({
          applicationId: b.applicationId,
          platform: b.platform,
        });
        console.log(`${pc.green('✓')} Credentials are valid for ${pc.bold(b.platform)} bot`);
      } catch (err: any) {
        const message = err?.message || 'Connection test failed';
        log.error(`Credential test failed: ${message}`);
        process.exit(1);
      }
    });

  // ── connect ───────────────────────────────────────────

  bot
    .command('connect <botId>')
    .description('Connect and start a bot')
    .action(async (botId: string) => {
      const client = await getTrpcClient();
      const b = await findBot(client, botId);

      log.status(`Connecting ${b.platform} bot ${b.applicationId}...`);

      const connectResult = await client.agentBotProvider.connectBot.mutate({
        applicationId: b.applicationId,
        platform: b.platform,
      });

      console.log(
        `${pc.green('✓')} Connected ${pc.bold(b.platform)} bot ${pc.bold(b.applicationId)}`,
      );
      if ((connectResult as any)?.status) {
        console.log(`  Status: ${(connectResult as any).status}`);
      }
    });
}
