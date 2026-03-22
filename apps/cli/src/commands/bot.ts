import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable } from '../utils/format';
import { log } from '../utils/logger';

const SUPPORTED_PLATFORMS = ['discord', 'slack', 'telegram', 'lark', 'feishu', 'wechat'];

const PLATFORM_CREDENTIAL_FIELDS: Record<string, string[]> = {
  discord: ['botToken', 'publicKey'],
  feishu: ['appSecret'],
  lark: ['appSecret'],
  slack: ['botToken', 'signingSecret'],
  telegram: ['botToken'],
  wechat: ['botToken', 'botId'],
};

function parseCredentials(
  platform: string,
  options: Record<string, string | undefined>,
): Record<string, string> {
  const creds: Record<string, string> = {};

  if (options.botToken) creds.botToken = options.botToken;
  if (options.botId) creds.botId = options.botId;
  if (options.publicKey) creds.publicKey = options.publicKey;
  if (options.signingSecret) creds.signingSecret = options.signingSecret;
  if (options.appSecret) creds.appSecret = options.appSecret;

  return creds;
}

export function registerBotCommand(program: Command) {
  const bot = program.command('bot').description('Manage bot integrations');

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

      const rows = items.map((b: any) => [
        b.id || '',
        b.platform || '',
        b.applicationId || '',
        b.agentId || '',
        b.enabled ? pc.green('enabled') : pc.dim('disabled'),
      ]);

      printTable(rows, ['ID', 'PLATFORM', 'APP ID', 'AGENT', 'STATUS']);
    });

  // ── view ──────────────────────────────────────────────

  bot
    .command('view <botId>')
    .description('View bot integration details')
    .requiredOption('-a, --agent <agentId>', 'Agent ID')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (botId: string, options: { agent: string; json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.agentBotProvider.getByAgentId.query({
        agentId: options.agent,
      });
      const items = Array.isArray(result) ? result : [];
      const item = items.find((b: any) => b.id === botId);

      if (!item) {
        log.error(`Bot integration not found: ${botId}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(item, fields);
        return;
      }

      const b = item as any;
      console.log(pc.bold(`${b.platform} bot`));
      console.log(pc.dim(`ID: ${b.id}`));
      console.log(`Application ID: ${b.applicationId}`);
      console.log(`Status: ${b.enabled ? pc.green('enabled') : pc.dim('disabled')}`);

      if (b.credentials && typeof b.credentials === 'object') {
        console.log();
        console.log(pc.bold('Credentials:'));
        for (const [key, value] of Object.entries(b.credentials)) {
          const val = String(value);
          const masked = val.length > 8 ? val.slice(0, 4) + '****' + val.slice(-4) : '****';
          console.log(`  ${key}: ${masked}`);
        }
      }
    });

  // ── add ───────────────────────────────────────────────

  bot
    .command('add')
    .description('Add a bot integration to an agent')
    .requiredOption('-a, --agent <agentId>', 'Agent ID')
    .requiredOption('--platform <platform>', `Platform: ${SUPPORTED_PLATFORMS.join(', ')}`)
    .requiredOption('--app-id <appId>', 'Application ID for webhook routing')
    .option('--bot-token <token>', 'Bot token')
    .option('--bot-id <id>', 'Bot ID (WeChat)')
    .option('--public-key <key>', 'Public key (Discord)')
    .option('--signing-secret <secret>', 'Signing secret (Slack)')
    .option('--app-secret <secret>', 'App secret (Lark/Feishu)')
    .action(
      async (options: {
        agent: string;
        appId: string;
        appSecret?: string;
        botId?: string;
        botToken?: string;
        platform: string;
        publicKey?: string;
        signingSecret?: string;
      }) => {
        if (!SUPPORTED_PLATFORMS.includes(options.platform)) {
          log.error(`Invalid platform. Must be one of: ${SUPPORTED_PLATFORMS.join(', ')}`);
          process.exit(1);
          return;
        }

        const credentials = parseCredentials(options.platform, options);
        const requiredFields = PLATFORM_CREDENTIAL_FIELDS[options.platform] || [];
        const missing = requiredFields.filter((f) => !credentials[f]);
        if (missing.length > 0) {
          log.error(
            `Missing required credentials for ${options.platform}: ${missing.map((f) => '--' + f.replaceAll(/([A-Z])/g, '-$1').toLowerCase()).join(', ')}`,
          );
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();
        const result = await client.agentBotProvider.create.mutate({
          agentId: options.agent,
          applicationId: options.appId,
          credentials,
          platform: options.platform,
        });
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
          platform?: string;
          publicKey?: string;
          signingSecret?: string;
        },
      ) => {
        const input: Record<string, any> = { id: botId };

        const credentials: Record<string, string> = {};
        if (options.botToken) credentials.botToken = options.botToken;
        if (options.botId) credentials.botId = options.botId;
        if (options.publicKey) credentials.publicKey = options.publicKey;
        if (options.signingSecret) credentials.signingSecret = options.signingSecret;
        if (options.appSecret) credentials.appSecret = options.appSecret;

        if (Object.keys(credentials).length > 0) input.credentials = credentials;
        if (options.appId) input.applicationId = options.appId;
        if (options.platform) input.platform = options.platform;

        if (Object.keys(input).length <= 1) {
          log.error('No changes specified.');
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();
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

  // ── connect ───────────────────────────────────────────

  bot
    .command('connect <botId>')
    .description('Connect and start a bot')
    .requiredOption('-a, --agent <agentId>', 'Agent ID')
    .action(async (botId: string, options: { agent: string }) => {
      // First fetch the bot to get platform and applicationId
      const client = await getTrpcClient();
      const result = await client.agentBotProvider.getByAgentId.query({
        agentId: options.agent,
      });
      const items = Array.isArray(result) ? result : [];
      const item = items.find((b: any) => b.id === botId);

      if (!item) {
        log.error(`Bot integration not found: ${botId}`);
        process.exit(1);
        return;
      }

      const b = item as any;
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
