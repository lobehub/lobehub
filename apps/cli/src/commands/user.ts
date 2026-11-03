import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';
import { log } from '../utils/logger';

export function registerUserCommand(program: Command) {
  const user = program.command('user').description('Manage user account and settings');

  // ── info ──────────────────────────────────────────────

  user
    .command('info')
    .description('View user registration info')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.user.getUserRegistrationDuration.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      if (typeof r === 'number') {
        const days = Math.floor(r / (1000 * 60 * 60 * 24));
        console.log(`Registered for ${pc.bold(String(days))} day(s).`);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    });

  // ── settings ──────────────────────────────────────────

  user
    .command('settings')
    .description('Update user settings')
    .requiredOption('--data <json>', 'Settings JSON')
    .action(async (options: { data: string }) => {
      let data: any;
      try {
        data = JSON.parse(options.data);
      } catch {
        log.error('Invalid settings JSON.');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      await client.user.updateSettings.mutate(data);
      console.log(`${pc.green('✓')} Settings updated.`);
    });

  // ── preferences ───────────────────────────────────────

  user
    .command('preferences')
    .description('Update user preferences')
    .requiredOption('--data <json>', 'Preferences JSON')
    .action(async (options: { data: string }) => {
      let data: any;
      try {
        data = JSON.parse(options.data);
      } catch {
        log.error('Invalid preferences JSON.');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      await client.user.updatePreference.mutate(data);
      console.log(`${pc.green('✓')} Preferences updated.`);
    });

  // ── update-avatar ─────────────────────────────────────

  user
    .command('update-avatar <url>')
    .description('Update user avatar (URL or Base64)')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (url: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.user.updateAvatar.mutate(url);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      console.log(`${pc.green('✓')} Avatar updated.`);
    });

  // ── update-name ───────────────────────────────────────

  user
    .command('update-name')
    .description('Update user full name or username')
    .option('--full-name <name>', 'Update full name (max 64 chars)')
    .option('--username <name>', 'Update username (alphanumeric + underscore)')
    .action(async (options: { fullName?: string; username?: string }) => {
      if (!options.fullName && !options.username) {
        log.error('No changes specified. Use --full-name or --username.');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();

      if (options.fullName) {
        await client.user.updateFullName.mutate(options.fullName);
        console.log(`${pc.green('✓')} Full name updated to ${pc.bold(options.fullName)}`);
      }

      if (options.username) {
        await client.user.updateUsername.mutate(options.username);
        console.log(`${pc.green('✓')} Username updated to ${pc.bold(options.username)}`);
      }
    });
}
