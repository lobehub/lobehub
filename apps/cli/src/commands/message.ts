import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';

export function registerMessageCommand(program: Command) {
  const message = program.command('message').description('Manage messages');

  // ── list ──────────────────────────────────────────────

  message
    .command('list')
    .description('List messages')
    .option('--topic-id <id>', 'Filter by topic ID')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('--session-id <id>', 'Filter by session ID')
    .option('-L, --limit <n>', 'Page size', '30')
    .option('--page <n>', 'Page number', '1')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        agentId?: string;
        json?: string | boolean;
        limit?: string;
        page?: string;
        sessionId?: string;
        topicId?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.topicId) input.topicId = options.topicId;
        if (options.agentId) input.agentId = options.agentId;
        if (options.sessionId) input.sessionId = options.sessionId;
        if (options.limit) input.pageSize = Number.parseInt(options.limit, 10);
        if (options.page) input.current = Number.parseInt(options.page, 10);

        const result = await client.message.getMessages.query(input as any);
        const items = Array.isArray(result) ? result : ((result as any).items ?? []);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(items, fields);
          return;
        }

        if (items.length === 0) {
          console.log('No messages found.');
          return;
        }

        const rows = items.map((m: any) => [
          m.id || '',
          m.role || '',
          truncate(m.content || '', 60),
          m.createdAt ? timeAgo(m.createdAt) : '',
        ]);

        printTable(rows, ['ID', 'ROLE', 'CONTENT', 'CREATED']);
      },
    );

  // ── search ────────────────────────────────────────────

  message
    .command('search <keywords>')
    .description('Search messages')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (keywords: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.message.searchMessages.query({ keywords });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No messages found.');
        return;
      }

      const rows = items.map((m: any) => [m.id || '', m.role || '', truncate(m.content || '', 60)]);

      printTable(rows, ['ID', 'ROLE', 'CONTENT']);
    });

  // ── delete ────────────────────────────────────────────

  message
    .command('delete <ids...>')
    .description('Delete one or more messages')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (ids: string[], options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(
          `Are you sure you want to delete ${ids.length} message(s)?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      if (ids.length === 1) {
        await client.message.removeMessage.mutate({ id: ids[0] });
      } else {
        await client.message.removeMessages.mutate({ ids });
      }

      console.log(`${pc.green('✓')} Deleted ${ids.length} message(s)`);
    });

  // ── count ─────────────────────────────────────────────

  message
    .command('count')
    .description('Count messages')
    .option('--start <date>', 'Start date (ISO format)')
    .option('--end <date>', 'End date (ISO format)')
    .option('--json', 'Output JSON')
    .action(async (options: { end?: string; json?: boolean; start?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = {};
      if (options.start) input.startDate = options.start;
      if (options.end) input.endDate = options.end;

      const count = await client.message.count.query(input as any);

      if (options.json) {
        console.log(JSON.stringify({ count }));
        return;
      }

      console.log(`Messages: ${pc.bold(String(count))}`);
    });

  // ── heatmap ───────────────────────────────────────────

  message
    .command('heatmap')
    .description('Get message activity heatmap')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.message.getHeatmaps.query();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result || (Array.isArray(result) && result.length === 0)) {
        console.log('No heatmap data.');
        return;
      }

      // Display as simple list
      const items = Array.isArray(result) ? result : [result];
      for (const entry of items) {
        const e = entry as any;
        console.log(`${e.date || e.day || ''}: ${pc.bold(String(e.count || e.value || 0))}`);
      }
    });
}
