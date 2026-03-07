import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerSessionCommand(program: Command) {
  const session = program.command('session').description('Manage chat sessions');

  // ── list ──────────────────────────────────────────────

  session
    .command('list')
    .description('List sessions')
    .option('-L, --limit <n>', 'Page size', '30')
    .option('--page <n>', 'Page number', '1')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; limit?: string; page?: string }) => {
      const client = await getTrpcClient();
      const pageSize = Number.parseInt(options.limit || '30', 10);
      const current = Number.parseInt(options.page || '1', 10);

      const result = await client.session.getSessions.query({ current, pageSize });
      const items = Array.isArray(result) ? result : ((result as any).items ?? []);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No sessions found.');
        return;
      }

      const rows = items.map((s: any) => [
        s.id || '',
        truncate(s.title || s.meta?.title || 'Untitled', 40),
        s.type || '',
        s.updatedAt ? timeAgo(s.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'TYPE', 'UPDATED']);
    });

  // ── search ────────────────────────────────────────────

  session
    .command('search <keywords>')
    .description('Search sessions')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (keywords: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.session.searchSessions.query({ keywords });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No sessions found.');
        return;
      }

      const rows = items.map((s: any) => [
        s.id || '',
        truncate(s.title || s.meta?.title || 'Untitled', 40),
        s.type || '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'TYPE']);
    });

  // ── create ────────────────────────────────────────────

  session
    .command('create')
    .description('Create a new session')
    .option('--type <type>', 'Session type: agent or group', 'agent')
    .option('-t, --title <title>', 'Session title')
    .option('-m, --model <model>', 'Model ID')
    .option('-s, --system-role <role>', 'System role prompt')
    .action(
      async (options: { model?: string; systemRole?: string; title?: string; type: string }) => {
        const client = await getTrpcClient();

        const config: Record<string, any> = {};
        if (options.title) config.title = options.title;
        if (options.model) config.model = options.model;
        if (options.systemRole) config.systemRole = options.systemRole;

        const sessionData: Record<string, any> = {};

        const result = await client.session.createSession.mutate({
          config,
          session: sessionData,
          type: options.type as 'agent' | 'group',
        });

        const r = result as any;
        console.log(`${pc.green('✓')} Created session ${pc.bold(r.id || r)}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  session
    .command('edit <id>')
    .description('Update a session')
    .option('-t, --title <title>', 'New title')
    .option('--pinned', 'Pin the session')
    .option('--no-pinned', 'Unpin the session')
    .option('--group <groupId>', 'Move to group')
    .action(async (id: string, options: { group?: string; pinned?: boolean; title?: string }) => {
      const value: Record<string, any> = {};
      if (options.title) value.title = options.title;
      if (options.pinned !== undefined) value.pinned = options.pinned;
      if (options.group) value.group = options.group;

      if (Object.keys(value).length === 0) {
        log.error('No changes specified. Use --title, --pinned, or --group.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.session.updateSession.mutate({ id, value });
      console.log(`${pc.green('✓')} Updated session ${pc.bold(id)}`);
    });

  // ── delete ────────────────────────────────────────────

  session
    .command('delete <id>')
    .description('Delete a session')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this session?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.session.removeSession.mutate({ id });
      console.log(`${pc.green('✓')} Deleted session ${pc.bold(id)}`);
    });
}
