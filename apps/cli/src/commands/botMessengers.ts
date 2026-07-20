/**
 * `lh bot messengers ...` — manages the user's System Bot installations
 * (Slack workspaces, Discord guilds, Telegram, WeChat), distinct from per-agent bots.
 *
 * Mirrors `bot ...` (per-agent CRUD) and `bot message ...` (send/read), but
 * operates on `messenger_installations` (workspace-scoped) and
 * `messenger_account_links` (per-user routing). Subcommands talk directly to
 * `lambdaClient.messenger.*` — there's no shared CLI-side service layer for
 * this domain yet.
 *
 * **uninstall vs unlink** (recurring confusion — surface in command help):
 * - `uninstall <installationId>` revokes the install for the **whole
 *   workspace**. Other users in that workspace can no longer use the bot.
 * - `links unlink <platform>` only removes the **current user's** account
 *   binding. Workspace stays installed; colleagues are unaffected.
 */
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable } from '../utils/format';

const PLATFORMS = ['telegram', 'slack', 'discord', 'wechat'] as const;
type MessengerPlatform = (typeof PLATFORMS)[number];

const validatePlatform = (value: string): MessengerPlatform => {
  if (!(PLATFORMS as readonly string[]).includes(value)) {
    throw new Error(`Unknown messenger platform: ${value}. Valid values: ${PLATFORMS.join(', ')}.`);
  }
  return value as MessengerPlatform;
};

export function registerBotMessengersCommands(bot: Command) {
  const messengers = bot
    .command('messengers')
    .description(
      'Manage System Bot messenger installations (Slack workspaces, Discord guilds, Telegram, WeChat) ' +
        'and per-user account links',
    );

  // ── installations ──────────────────────────────────────

  messengers
    .command('list')
    .description('List all System Bot installations the current user has connected.')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const installations = await client.messenger.listMyInstallations.query();

      if (options.json) {
        outputJson(installations);
        return;
      }

      if (installations.length === 0) {
        console.log('No System Bot installations connected.');
        console.log(
          `\nRun ${pc.dim('lh bot messengers platforms')} to see what's available, then install via ` +
            `${pc.dim('Settings → Messenger')} (OAuth requires a browser).`,
        );
        return;
      }

      const rows = installations.map((i: any) => [
        i.id || '',
        i.platform || '',
        i.tenantName || i.tenantId || '(global)',
        i.applicationId || '',
        i.installedAt ? new Date(i.installedAt).toISOString().slice(0, 10) : '',
      ]);
      printTable(rows, ['INSTALLATION ID', 'PLATFORM', 'TENANT', 'APP ID', 'INSTALLED']);
      console.log(
        `\nUse ${pc.dim('@<INSTALLATION ID>')} as the positional argument on ` +
          `${pc.dim('lh bot message send/dm/thread reply')} to route through a System Bot install.`,
      );
    });

  messengers
    .command('view <installationId>')
    .description('Show detail for one installation.')
    .option('--json', 'Output JSON')
    .action(async (installationId: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const installations = (await client.messenger.listMyInstallations.query()) as any[];
      const install = installations.find((i) => i.id === installationId);

      if (!install) {
        // Under `--json`, scripts need a parseable output even on miss —
        // emit `null` to stdout (rather than a human-readable error), then
        // exit non-zero so error handling still works in pipelines.
        if (options.json) {
          outputJson(null);
        } else {
          console.error(pc.red(`Installation not found: ${installationId}`));
        }
        process.exit(1);
        return;
      }

      if (options.json) {
        outputJson(install);
        return;
      }

      console.log(`${pc.bold('Installation')} ${pc.dim(install.id)}`);
      console.log(`  Platform:       ${install.platform}`);
      console.log(`  Tenant:         ${install.tenantName || install.tenantId || '(global)'}`);
      if (install.tenantId && install.tenantName) {
        console.log(`  Tenant ID:      ${install.tenantId}`);
      }
      console.log(`  Application ID: ${install.applicationId}`);
      if (install.scope) console.log(`  OAuth Scope:    ${install.scope}`);
      if (install.installedAt) {
        console.log(`  Installed:      ${new Date(install.installedAt).toISOString()}`);
      }
      if (install.enterpriseId) {
        console.log(`  Enterprise ID:  ${install.enterpriseId}`);
      }
      if (install.isEnterpriseInstall) {
        console.log(`  Enterprise:     yes`);
      }
    });

  messengers
    .command('uninstall <installationId>')
    .description(
      'Revoke a workspace install. AFFECTS EVERY USER IN THAT WORKSPACE — for Slack this freezes ' +
        'the bot; for Discord it removes the audit entry (a guild admin must remove the bot ' +
        'separately). To disconnect only your own account, use `bot messengers links unlink`.',
    )
    .option('--yes', 'Skip confirmation prompt')
    .action(async (installationId: string, options: { yes?: boolean }) => {
      const client = await getTrpcClient();

      if (!options.yes) {
        const installations = (await client.messenger.listMyInstallations.query()) as any[];
        const install = installations.find((i) => i.id === installationId);
        const label = install
          ? `${install.platform} (${install.tenantName || install.tenantId || 'global'})`
          : installationId;
        const ok = await confirm(
          `${pc.yellow('⚠')}  Uninstall ${pc.bold(label)} — this revokes the install for the whole workspace. Continue?`,
        );
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }

      await client.messenger.uninstallInstallation.mutate({ installationId });
      console.log(`${pc.green('✓')} Installation ${pc.dim(installationId)} revoked.`);
    });

  messengers
    .command('platforms')
    .description('List the platforms available for System Bot OAuth install.')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const platforms = await client.messenger.availablePlatforms.query();

      if (options.json) {
        outputJson(platforms);
        return;
      }

      if (platforms.length === 0) {
        console.log('No System Bot platforms are configured on this deployment.');
        return;
      }

      const rows = platforms.map((p: any) => [
        p.id || '',
        p.name || '',
        p.appId || '',
        p.botUsername || '',
      ]);
      printTable(rows, ['ID', 'NAME', 'APP ID', 'BOT USERNAME']);
      console.log(
        `\nInstalls are initiated via ${pc.dim('Settings → Messenger')} in the web UI ` +
          '(OAuth needs a browser).',
      );
    });

  // ── account links ──────────────────────────────────────

  const links = messengers
    .command('links')
    .description('Manage per-user account links — routing of inbound IM to your agents');

  links
    .command('list')
    .description('List all your account links across platforms and tenants.')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const linkRows = await client.messenger.listMyLinks.query();

      if (options.json) {
        outputJson(linkRows);
        return;
      }

      if (linkRows.length === 0) {
        console.log('No account links yet. Complete verify-im on a platform first.');
        return;
      }

      const rows = linkRows.map((l: any) => [
        l.platform || '',
        l.tenantId || '(global)',
        l.activeAgentId || pc.dim('(unset)'),
        l.platformUsername || l.platformUserId || '',
      ]);
      printTable(rows, ['PLATFORM', 'TENANT', 'ACTIVE AGENT', 'PLATFORM USER']);
    });

  links
    .command('view <platform>')
    .description('Show one account link.')
    .option('--tenant <id>', 'Tenant scope (Slack workspace id). Omit for global-bot platforms.')
    .option('--json', 'Output JSON')
    .action(async (platform: string, options: { json?: boolean; tenant?: string }) => {
      const client = await getTrpcClient();
      const platformValidated = validatePlatform(platform);
      const link = await client.messenger.getMyLink.query({
        platform: platformValidated,
        tenantId: options.tenant,
      });

      if (!link) {
        console.error(
          pc.red(
            `No link found for ${platform}${options.tenant ? ` (tenant ${options.tenant})` : ''}`,
          ),
        );
        process.exit(1);
        return;
      }

      if (options.json) {
        outputJson(link);
        return;
      }

      console.log(`${pc.bold('Link')} ${pc.dim(link.platform)}`);
      if (link.tenantId) console.log(`  Tenant ID:        ${link.tenantId}`);
      console.log(`  Platform User ID: ${link.platformUserId}`);
      if (link.platformUsername) {
        console.log(`  Platform User:    ${link.platformUsername}`);
      }
      console.log(`  Active Agent:     ${link.activeAgentId ?? pc.dim('(unset)')}`);
    });

  links
    .command('set-agent <platform>')
    .description('Change which agent receives inbound IM on a platform link.')
    .requiredOption('--agent <id>', 'Agent id to route to, or "none" to clear the active agent.')
    .option('--tenant <id>', 'Tenant scope (Slack workspace id). Omit for global-bot platforms.')
    .action(async (platform: string, options: { agent: string; tenant?: string }) => {
      const client = await getTrpcClient();
      const platformValidated = validatePlatform(platform);
      const agentId = options.agent === 'none' ? null : options.agent;

      await client.messenger.setActiveAgent.mutate({
        agentId,
        platform: platformValidated,
        tenantId: options.tenant,
      });

      const scope = options.tenant ? ` (tenant ${options.tenant})` : '';
      const target = agentId === null ? 'cleared' : `set to agent ${pc.dim(agentId)}`;
      console.log(`${pc.green('✓')} Active agent for ${platform}${scope} ${target}.`);
    });

  links
    .command('unlink <platform>')
    .description(
      'Remove your account link for a platform. Workspace install is unaffected — colleagues ' +
        'can still use the bot.',
    )
    .option('--tenant <id>', 'Tenant scope (Slack workspace id). Omit for global-bot platforms.')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (platform: string, options: { tenant?: string; yes?: boolean }) => {
      const client = await getTrpcClient();
      const platformValidated = validatePlatform(platform);

      if (!options.yes) {
        const ok = await confirm(
          `Unlink your account from ${pc.bold(platform)}${options.tenant ? ` (tenant ${options.tenant})` : ''}?`,
        );
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }

      await client.messenger.unlink.mutate({
        platform: platformValidated,
        tenantId: options.tenant,
      });
      console.log(`${pc.green('✓')} Unlinked.`);
    });
}
