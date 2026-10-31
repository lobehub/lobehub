import type { NotificationChannelSettings, NotificationSettings } from '@lobechat/types';
import { NotificationSettingsSchema } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { resolveWorkspaceId } from '../api/workspace';
import { outputJson, printTable } from '../utils/format';
import { log } from '../utils/logger';

const CHANNELS = ['email', 'im', 'inbox', 'push'] as const;
type Channel = (typeof CHANNELS)[number];

interface ScopeOptions {
  /** `true` = the current workspace scope; a string = that workspace. */
  workspace?: boolean | string;
}

interface ToggleOptions extends ScopeOptions {
  platform?: string;
  type?: string[];
}

const WORKSPACE_OPTION_DESC =
  'Use your per-member preferences for a workspace (the current scope, or the given id) instead of personal settings';

const collect = (value: string, previous: string[] = []) => [...previous, value];

/**
 * Resolve which store a call targets. Personal settings are account-wide;
 * `--workspace` targets the caller's per-member gate for one workspace, which
 * needs a resolvable workspace id.
 */
function resolveScope(options: ScopeOptions): { workspaceId?: string } {
  if (!options.workspace) return {};
  const workspaceId = resolveWorkspaceId(
    typeof options.workspace === 'string' ? options.workspace : undefined,
  );
  if (!workspaceId) {
    log.error(
      "No workspace in scope. Pass '--workspace <id>' or run 'lh workspace use <id>' first.",
    );
    process.exit(1);
  }
  return { workspaceId };
}

async function readSettings(workspaceId?: string): Promise<NotificationSettings> {
  const client = await getTrpcClient(workspaceId);
  if (!workspaceId) return client.user.getNotificationSettings.query();
  const preference = await client.workspaceUserSettings.getPreference.query();
  return preference.notification ?? {};
}

async function writeSettings(patch: NotificationSettings, workspaceId?: string) {
  const client = await getTrpcClient(workspaceId);
  if (!workspaceId) {
    await client.user.updateNotificationSettings.mutate(patch);
    return;
  }
  // The server merges `notification` one switch at a time, like the personal path.
  await client.workspaceUserSettings.updatePreference.mutate({ notification: patch });
}

/** Parse `category.type` into its two parts. */
function parseType(value: string): [string, string] {
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) {
    log.error(`Invalid --type '${value}'. Use <category>.<type>, e.g. billing.credit_balance_low.`);
    process.exit(1);
  }
  return [value.slice(0, dot), value.slice(dot + 1)];
}

/** Build the minimal patch that flips one channel, platform, or a set of types. */
function buildTogglePatch(
  channel: Channel,
  enabled: boolean,
  options: ToggleOptions,
  workspaceId?: string,
): NotificationSettings {
  const channelPatch: NotificationChannelSettings = {};
  if (options.type?.length) {
    const items: Record<string, Record<string, boolean>> = {};
    for (const value of options.type) {
      const [category, type] = parseType(value);
      items[category] = { ...items[category], [type]: enabled };
    }
    channelPatch.items = items;
  } else {
    channelPatch.enabled = enabled;
  }

  if (!options.platform) return { [channel]: channelPatch };

  if (channel !== 'im') {
    log.error('--platform only applies to the im channel.');
    process.exit(1);
  }
  if (workspaceId) {
    // Workspace preferences gate IM as a whole; platform picks follow the person.
    log.error('--platform is a personal setting; drop --workspace to configure a platform.');
    process.exit(1);
  }
  return { im: { platforms: { [options.platform]: channelPatch } } };
}

function describeChannel(settings: NotificationChannelSettings | undefined) {
  const enabled = settings?.enabled === false ? pc.red('off') : pc.green('on');
  const disabled = Object.entries(settings?.items ?? {}).flatMap(([category, types]) =>
    Object.entries(types)
      .filter(([, value]) => value === false)
      .map(([type]) => `${category}.${type}`),
  );
  return [enabled, disabled.length > 0 ? disabled.join(', ') : pc.dim('-')];
}

function printSettings(settings: NotificationSettings, workspaceId?: string) {
  console.log(
    workspaceId
      ? `Workspace notification preferences (${pc.bold(workspaceId)})`
      : 'Personal notification settings',
  );
  console.log();

  const rows: string[][] = CHANNELS.map((channel) => [
    channel,
    ...describeChannel(settings[channel]),
  ]);
  for (const [platform, value] of Object.entries(settings.im?.platforms ?? {})) {
    rows.push([`im:${platform}`, ...describeChannel(value)]);
  }
  printTable(rows, ['CHANNEL', 'STATUS', 'TYPES OFF']);

  if (!workspaceId) {
    const summary = settings.content?.scheduledTaskSummary === false ? 'off' : 'on';
    console.log();
    console.log(`Scheduled task summary in notifications: ${summary}`);
  }
  console.log();
  console.log(pc.dim('Unset switches default to on.'));
}

function parseChannel(value: string): Channel {
  if (!(CHANNELS as readonly string[]).includes(value)) {
    log.error(`Unknown channel '${value}'. Use one of: ${CHANNELS.join(', ')}.`);
    process.exit(1);
  }
  return value as Channel;
}

export function registerNotificationCommand(program: Command) {
  const notification = program
    .command('notification')
    .description('Manage notification delivery settings (email, IM, inbox, push)');

  // ── settings ──────────────────────────────────────────

  notification
    .command('settings')
    .description('Show notification settings')
    .option('--workspace [id]', WORKSPACE_OPTION_DESC)
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: ScopeOptions & { json?: string | boolean }) => {
      const { workspaceId } = resolveScope(options);
      const settings = await readSettings(workspaceId);

      if (options.json !== undefined) {
        outputJson(settings, typeof options.json === 'string' ? options.json : undefined);
        return;
      }

      printSettings(settings, workspaceId);
    });

  // ── enable / disable ──────────────────────────────────

  for (const [name, enabled] of [
    ['enable', true],
    ['disable', false],
  ] as const) {
    notification
      .command(`${name} <channel>`)
      .description(
        `${enabled ? 'Enable' : 'Disable'} a channel (${CHANNELS.join('|')}), one IM platform, or specific notification types`,
      )
      .option(
        '--type <category.type>',
        `Only ${name} this notification type, e.g. billing.credit_balance_low (repeatable)`,
        collect,
      )
      .option('--platform <id>', 'IM platform id, e.g. telegram, slack (im channel only)')
      .option('--workspace [id]', WORKSPACE_OPTION_DESC)
      .action(async (channelArg: string, options: ToggleOptions) => {
        const channel = parseChannel(channelArg);
        const { workspaceId } = resolveScope(options);
        await writeSettings(buildTogglePatch(channel, enabled, options, workspaceId), workspaceId);

        const target = options.platform ? `im:${options.platform}` : channel;
        const what = options.type?.length ? `${options.type.join(', ')} on ${target}` : target;
        console.log(`${pc.green('✓')} ${enabled ? 'Enabled' : 'Disabled'} ${what}.`);
      });
  }

  // ── update ────────────────────────────────────────────

  notification
    .command('update')
    .description('Merge a notification settings patch (JSON); untouched switches keep their value')
    .requiredOption(
      '--data <json>',
      'Patch JSON, e.g. \'{"email":{"enabled":false},"content":{"scheduledTaskSummary":false}}\'',
    )
    .option('--workspace [id]', WORKSPACE_OPTION_DESC)
    .action(async (options: ScopeOptions & { data: string }) => {
      let data: unknown;
      try {
        data = JSON.parse(options.data);
      } catch {
        log.error('Invalid notification settings JSON.');
        process.exit(1);
        return;
      }

      // The workspace store accepts any shape, so check the patch here: a misspelled
      // channel would otherwise be saved and silently ignored by delivery.
      const parsed = NotificationSettingsSchema.safeParse(data);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        );
        log.error(`Invalid notification settings:\n  ${issues.join('\n  ')}`);
        process.exit(1);
        return;
      }
      const patch: NotificationSettings = parsed.data;

      const { workspaceId } = resolveScope(options);
      await writeSettings(patch, workspaceId);
      console.log(`${pc.green('✓')} Notification settings updated.`);
    });
}
