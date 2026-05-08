import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerMessageCommand(program: Command) {
  const message = program.command('message').description('Manage messages');

  // ── list ──────────────────────────────────────────────

  message
    .command('list')
    .description('List messages')
    .option('--topic-id <id>', 'Filter by topic ID')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('-L, --limit <n>', 'Page size', '30')
    .option('-P, --page <n>', 'Page number', '1')
    .option('--user', 'Only show user messages')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        agentId?: string;
        json?: string | boolean;
        limit?: string;
        page?: string;
        topicId?: string;
        user?: boolean;
      }) => {
        const client = await getTrpcClient();

        const hasFilter = options.topicId || options.agentId;
        const pageSize = options.limit ? Number.parseInt(options.limit, 10) : undefined;
        const current = options.page
          ? Math.max(Number.parseInt(options.page, 10) - 1, 0)
          : undefined;

        let items: any[];

        if (hasFilter) {
          const input: Record<string, any> = {};
          if (options.topicId) input.topicId = options.topicId;
          if (options.agentId) input.agentId = options.agentId;
          if (pageSize) input.pageSize = pageSize;
          if (current) input.current = current;

          const result = await client.message.getMessages.query(input as any);
          items = Array.isArray(result) ? result : ((result as any).items ?? []);
        } else {
          const input: Record<string, any> = {};
          if (pageSize) input.pageSize = pageSize;
          if (current) input.current = current;

          const result = await client.message.listAll.query(input as any);
          items = Array.isArray(result) ? result : [];
        }

        if (options.user) {
          items = items.filter((m: any) => m.role === 'user');
        }

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

  // ── create ────────────────────────────────────────────

  message
    .command('create')
    .description('Create a message')
    .requiredOption('-r, --role <role>', 'Message role (user, assistant, system)')
    .requiredOption('-c, --content <content>', 'Message content')
    .option('--agent-id <id>', 'Agent ID')
    .option('--topic-id <id>', 'Topic ID')
    .option('--session-id <id>', 'Session ID')
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        agentId?: string;
        content: string;
        json?: boolean;
        role: string;
        sessionId?: string;
        topicId?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          content: options.content,
          role: options.role,
        };
        if (options.agentId) input.agentId = options.agentId;
        if (options.topicId) input.topicId = options.topicId;
        if (options.sessionId) input.sessionId = options.sessionId;

        const result = await client.message.createMessage.mutate(input as any);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const r = result as any;
        console.log(`${pc.green('✓')} Created message ${pc.bold(r.id || '')}`);
      },
    );

  // ── edit ────────────────────────────────────────────

  message
    .command('edit <id>')
    .description('Update a message')
    .option('-c, --content <content>', 'New content')
    .option('--role <role>', 'New role')
    .action(async (id: string, options: { content?: string; role?: string }) => {
      const value: Record<string, any> = {};
      if (options.content) value.content = options.content;
      if (options.role) value.role = options.role;

      if (Object.keys(value).length === 0) {
        log.error('No changes specified. Use --content or --role.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.message.update.mutate({ id, value } as any);
      console.log(`${pc.green('✓')} Updated message ${pc.bold(id)}`);
    });

  // ── add-files ───────────────────────────────────────

  message
    .command('add-files <id>')
    .description('Add files to a message')
    .requiredOption('--file-ids <ids>', 'Comma-separated file IDs')
    .action(async (id: string, options: { fileIds: string }) => {
      const fileIds = options.fileIds.split(',').map((s) => s.trim());

      const client = await getTrpcClient();
      await client.message.addFilesToMessage.mutate({ fileIds, id } as any);
      console.log(`${pc.green('✓')} Added ${fileIds.length} file(s) to message ${pc.bold(id)}`);
    });

  // ── word-count ──────────────────────────────────────

  message
    .command('word-count')
    .description('Count total words in messages')
    .option('--start <date>', 'Start date (ISO format)')
    .option('--end <date>', 'End date (ISO format)')
    .option('--json', 'Output JSON')
    .action(async (options: { end?: string; json?: boolean; start?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = {};
      if (options.start) input.startDate = options.start;
      if (options.end) input.endDate = options.end;

      const count = await client.message.countWords.query(input as any);

      if (options.json) {
        console.log(JSON.stringify({ wordCount: count }));
        return;
      }

      console.log(`Word count: ${pc.bold(String(count))}`);
    });

  // ── rank-models ─────────────────────────────────────

  message
    .command('rank-models')
    .description('Rank models by message usage')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.message.rankModels.query();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const items = Array.isArray(result) ? result : [];
      if (items.length === 0) {
        console.log('No model usage data.');
        return;
      }

      const rows = items.map((m: any) => [m.id || m.model || '', String(m.count || 0)]);
      printTable(rows, ['MODEL', 'COUNT']);
    });

  // ── delete-by-assistant ─────────────────────────────

  message
    .command('delete-by-assistant')
    .description('Delete messages by assistant context')
    .option('--agent-id <id>', 'Agent ID')
    .option('--session-id <id>', 'Session ID')
    .option('--topic-id <id>', 'Topic ID')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (options: {
        agentId?: string;
        sessionId?: string;
        topicId?: string;
        yes?: boolean;
      }) => {
        if (!options.agentId && !options.sessionId) {
          log.error('Specify at least --agent-id or --session-id.');
          process.exit(1);
        }

        if (!options.yes) {
          const confirmed = await confirm('Are you sure you want to delete messages by assistant?');
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();
        const input: Record<string, any> = {};
        if (options.agentId) input.agentId = options.agentId;
        if (options.sessionId) input.sessionId = options.sessionId;
        if (options.topicId) input.topicId = options.topicId;

        await client.message.removeMessagesByAssistant.mutate(input as any);
        console.log(`${pc.green('✓')} Deleted messages by assistant`);
      },
    );

  // ── delete-by-group ─────────────────────────────────

  message
    .command('delete-by-group <groupId>')
    .description('Delete messages by group')
    .option('--topic-id <id>', 'Topic ID')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (groupId: string, options: { topicId?: string; yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete messages by group?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      const input: Record<string, any> = { groupId };
      if (options.topicId) input.topicId = options.topicId;

      await client.message.removeMessagesByGroup.mutate(input as any);
      console.log(`${pc.green('✓')} Deleted messages for group ${pc.bold(groupId)}`);
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
