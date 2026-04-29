import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../api/client';
import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printBoxTable, printTable, timeAgo } from '../utils/format';
import { log } from '../utils/logger';
import { registerBotMessageCommands } from './botMessage';

// ── Access policy helpers ──────────────────────────────

const DM_POLICIES = ['open', 'allowlist', 'pairing', 'disabled'] as const;
const GROUP_POLICIES = ['open', 'allowlist', 'disabled'] as const;
type DmPolicy = (typeof DM_POLICIES)[number];
type GroupPolicy = (typeof GROUP_POLICIES)[number];

interface AllowEntry {
  id: string;
  name?: string;
}

/**
 * Normalize an allow-list value into `{id, name?}[]`. Mirrors the server-side
 * back-compat parser — `settings.allowFrom` may be on disk as a comma-separated
 * string, a bare `string[]`, or the current `{id, name?}[]` shape. The CLI
 * needs the canonical form before push/filter operations and before sending
 * back to the server.
 */
function normalizeAllowList(raw: unknown): AllowEntry[] {
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id }));
  }
  if (!Array.isArray(raw)) return [];
  const out: AllowEntry[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (id) out.push({ id });
      continue;
    }
    if (entry && typeof entry === 'object' && 'id' in entry) {
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== 'string' || !id.trim()) continue;
      const name = (entry as { name?: unknown }).name;
      out.push(
        typeof name === 'string' && name.trim()
          ? { id: id.trim(), name: name.trim() }
          : { id: id.trim() },
      );
    }
  }
  return out;
}

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

// ── Allowlist subcommand factory ────────────────────────

interface AllowlistGroupOptions {
  /** Description shown by `lh bot <name> --help`. */
  description: string;
  /** Settings field to mutate — `allowFrom` (user IDs) or `groupAllowFrom` (channel IDs). */
  fieldKey: 'allowFrom' | 'groupAllowFrom';
  /** Human-friendly description of what the `<id>` arg represents. */
  idLabel: string;
  /** Subcommand group name (`allowlist` or `group-allowlist`). */
  name: string;
}

/**
 * Build a `list / add / remove / clear` subcommand group around an
 * array-typed settings field (`allowFrom` or `groupAllowFrom`). All write
 * paths read existing settings first and merge — passing only a partial
 * `settings` object to the TRPC `update` would replace the whole JSONB
 * column and silently drop unrelated fields.
 */
function registerAllowlistCommand(bot: Command, opts: AllowlistGroupOptions) {
  const group = bot.command(opts.name).description(opts.description);

  // Read the current entries off a freshly-fetched bot row.
  const readEntries = (bot: any): AllowEntry[] =>
    normalizeAllowList((bot.settings as Record<string, unknown> | null)?.[opts.fieldKey]);

  // Build the next settings payload from existing settings + the new entries.
  const buildPayload = (bot: any, nextEntries: AllowEntry[]) => ({
    id: bot.id,
    settings: {
      ...(bot.settings as Record<string, unknown>),
      [opts.fieldKey]: nextEntries,
    },
  });

  group
    .command('list <botId>')
    .description(`List ${opts.fieldKey} entries`)
    .option('--json', 'Output JSON')
    .action(async (botId: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const b = await findBot(client, botId);
      const entries = readEntries(b);

      if (options.json) {
        outputJson(entries);
        return;
      }

      if (entries.length === 0) {
        console.log(`${pc.dim(`No ${opts.fieldKey} entries.`)}`);
        return;
      }

      printTable(
        entries.map((e) => [e.id, e.name ?? pc.dim('-')]),
        ['ID', 'NAME'],
      );
    });

  group
    .command('add <botId> <id>')
    .description(`Add a ${opts.idLabel} to ${opts.fieldKey}`)
    .option('--name <name>', 'Optional human-friendly label so you can recognise the entry later')
    .action(async (botId: string, id: string, options: { name?: string }) => {
      const trimmedId = id.trim();
      if (!trimmedId) {
        log.error('ID cannot be empty.');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      const b = await findBot(client, botId);
      const entries = readEntries(b);

      if (entries.some((e) => e.id === trimmedId)) {
        log.info(`${trimmedId} is already on the ${opts.fieldKey} list — nothing to do.`);
        return;
      }

      const trimmedName = options.name?.trim();
      const next = [
        ...entries,
        trimmedName ? { id: trimmedId, name: trimmedName } : { id: trimmedId },
      ];

      await client.agentBotProvider.update.mutate(buildPayload(b, next) as any);
      console.log(
        `${pc.green('✓')} Added ${pc.bold(trimmedId)}${trimmedName ? ` (${trimmedName})` : ''} to ${opts.fieldKey} (now ${next.length} entr${next.length === 1 ? 'y' : 'ies'})`,
      );
    });

  group
    .command('remove <botId> <id>')
    .description(`Remove a ${opts.idLabel} from ${opts.fieldKey}`)
    .action(async (botId: string, id: string) => {
      const trimmedId = id.trim();
      const client = await getTrpcClient();
      const b = await findBot(client, botId);
      const entries = readEntries(b);
      const next = entries.filter((e) => e.id !== trimmedId);

      if (next.length === entries.length) {
        log.info(`${trimmedId} is not on the ${opts.fieldKey} list — nothing to do.`);
        return;
      }

      await client.agentBotProvider.update.mutate(buildPayload(b, next) as any);
      console.log(
        `${pc.green('✓')} Removed ${pc.bold(trimmedId)} from ${opts.fieldKey} (${next.length} entr${next.length === 1 ? 'y' : 'ies'} left)`,
      );
    });

  group
    .command('clear <botId>')
    .description(`Clear all entries from ${opts.fieldKey}`)
    .option('--yes', 'Skip confirmation prompt')
    .action(async (botId: string, options: { yes?: boolean }) => {
      const client = await getTrpcClient();
      const b = await findBot(client, botId);
      const entries = readEntries(b);

      if (entries.length === 0) {
        log.info(`${opts.fieldKey} is already empty — nothing to do.`);
        return;
      }

      if (!options.yes) {
        const confirmed = await confirm(
          `Clear all ${entries.length} ${opts.fieldKey} entr${entries.length === 1 ? 'y' : 'ies'} from this bot?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      await client.agentBotProvider.update.mutate(buildPayload(b, []) as any);
      console.log(`${pc.green('✓')} Cleared ${opts.fieldKey} on bot ${pc.bold(botId)}`);
    });
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
    .option(
      '--dm-policy <policy>',
      `DM access policy (${DM_POLICIES.join('|')}). 'pairing' requires --user-id.`,
    )
    .option('--group-policy <policy>', `Group/channel access policy (${GROUP_POLICIES.join('|')})`)
    .option(
      '--user-id <id>',
      "Owner's platform user ID (required for --dm-policy=pairing; auto-trusts the operator in the global allowlist)",
    )
    .option('--server-id <id>', 'Default server / guild / workspace ID for AI tool calls')
    .action(
      async (
        botId: string,
        options: {
          appId?: string;
          appSecret?: string;
          botId?: string;
          botToken?: string;
          dmPolicy?: string;
          encryptKey?: string;
          groupPolicy?: string;
          platform?: string;
          publicKey?: string;
          secretToken?: string;
          serverId?: string;
          signingSecret?: string;
          userId?: string;
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

        // ── Settings (DM / group policy + identity fields) ────────────
        // Read-modify-write so we don't wipe `allowFrom`, `groupAllowFrom`,
        // or any other settings field the operator already configured.
        const settingsPatch: Record<string, unknown> = {};
        if (options.dmPolicy !== undefined) {
          if (!(DM_POLICIES as readonly string[]).includes(options.dmPolicy)) {
            log.error(
              `Invalid --dm-policy "${options.dmPolicy}". Must be one of: ${DM_POLICIES.join(', ')}`,
            );
            process.exit(1);
            return;
          }
          settingsPatch.dmPolicy = options.dmPolicy as DmPolicy;
        }
        if (options.groupPolicy !== undefined) {
          if (!(GROUP_POLICIES as readonly string[]).includes(options.groupPolicy)) {
            log.error(
              `Invalid --group-policy "${options.groupPolicy}". Must be one of: ${GROUP_POLICIES.join(', ')}`,
            );
            process.exit(1);
            return;
          }
          settingsPatch.groupPolicy = options.groupPolicy as GroupPolicy;
        }
        if (options.userId !== undefined) settingsPatch.userId = options.userId;
        if (options.serverId !== undefined) settingsPatch.serverId = options.serverId;

        if (Object.keys(settingsPatch).length > 0) {
          input.settings = {
            ...(existing.settings as Record<string, unknown>),
            ...settingsPatch,
          };
        }

        if (Object.keys(input).length <= 1) {
          log.error('No changes specified.');
          process.exit(1);
          return;
        }

        await client.agentBotProvider.update.mutate(input as any);
        console.log(`${pc.green('✓')} Updated bot ${pc.bold(botId)}`);
      },
    );

  // ── allowlist (DM / group user gate) ──────────────────

  registerAllowlistCommand(bot, {
    description: 'Manage the global user allowlist (gates DMs and group @mentions)',
    fieldKey: 'allowFrom',
    idLabel: 'platform user ID',
    name: 'allowlist',
  });

  registerAllowlistCommand(bot, {
    description: 'Manage the group/channel allowlist (used when groupPolicy=allowlist)',
    fieldKey: 'groupAllowFrom',
    idLabel: 'channel / group / thread ID',
    name: 'group-allowlist',
  });

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
