import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerTopicCommand(program: Command) {
  const topic = program.command('topic').description('Manage conversation topics');

  // ── list ──────────────────────────────────────────────

  topic
    .command('list')
    .description('List topics')
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
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.agentId) input.agentId = options.agentId;
        if (options.sessionId) input.sessionId = options.sessionId;
        if (options.limit) input.pageSize = Number.parseInt(options.limit, 10);
        if (options.page) input.current = Number.parseInt(options.page, 10);

        const result = await client.topic.getTopics.query(input as any);
        const items = Array.isArray(result) ? result : ((result as any).items ?? []);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(items, fields);
          return;
        }

        if (items.length === 0) {
          console.log('No topics found.');
          return;
        }

        const rows = items.map((t: any) => [
          t.id || '',
          truncate(t.title || 'Untitled', 50),
          t.favorite ? '★' : '',
          t.updatedAt ? timeAgo(t.updatedAt) : '',
        ]);

        printTable(rows, ['ID', 'TITLE', 'FAV', 'UPDATED']);
      },
    );

  // ── search ────────────────────────────────────────────

  topic
    .command('search <keywords>')
    .description('Search topics')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (keywords: string, options: { agentId?: string; json?: string | boolean }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { keywords };
      if (options.agentId) input.agentId = options.agentId;

      const result = await client.topic.searchTopics.query(input as any);
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No topics found.');
        return;
      }

      const rows = items.map((t: any) => [t.id || '', truncate(t.title || 'Untitled', 50)]);

      printTable(rows, ['ID', 'TITLE']);
    });

  // ── create ────────────────────────────────────────────

  topic
    .command('create')
    .description('Create a topic')
    .requiredOption('-t, --title <title>', 'Topic title')
    .option('--agent-id <id>', 'Agent ID')
    .option('--session-id <id>', 'Session ID')
    .option('--favorite', 'Mark as favorite')
    .action(
      async (options: {
        agentId?: string;
        favorite?: boolean;
        sessionId?: string;
        title: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = { title: options.title };
        if (options.agentId) input.agentId = options.agentId;
        if (options.sessionId) input.sessionId = options.sessionId;
        if (options.favorite) input.favorite = true;

        const result = await client.topic.createTopic.mutate(input as any);
        const r = result as any;
        console.log(`${pc.green('✓')} Created topic ${pc.bold(r.id || r)}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  topic
    .command('edit <id>')
    .description('Update a topic')
    .option('-t, --title <title>', 'New title')
    .option('--favorite', 'Mark as favorite')
    .option('--no-favorite', 'Unmark as favorite')
    .action(async (id: string, options: { favorite?: boolean; title?: string }) => {
      const value: Record<string, any> = {};
      if (options.title) value.title = options.title;
      if (options.favorite !== undefined) value.favorite = options.favorite;

      if (Object.keys(value).length === 0) {
        log.error('No changes specified. Use --title or --favorite.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.topic.updateTopic.mutate({ id, value });
      console.log(`${pc.green('✓')} Updated topic ${pc.bold(id)}`);
    });

  // ── delete ────────────────────────────────────────────

  topic
    .command('delete <ids...>')
    .description('Delete one or more topics')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (ids: string[], options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(`Are you sure you want to delete ${ids.length} topic(s)?`);
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      if (ids.length === 1) {
        await client.topic.removeTopic.mutate({ id: ids[0] });
      } else {
        await client.topic.batchDelete.mutate({ ids });
      }

      console.log(`${pc.green('✓')} Deleted ${ids.length} topic(s)`);
    });

  // ── recent ────────────────────────────────────────────

  topic
    .command('recent')
    .description('List recent topics')
    .option('-L, --limit <n>', 'Number of items', '10')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; limit?: string }) => {
      const client = await getTrpcClient();
      const limit = Number.parseInt(options.limit || '10', 10);

      const result = await client.topic.recentTopics.query({ limit });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No recent topics.');
        return;
      }

      const rows = items.map((t: any) => [
        t.id || '',
        truncate(t.title || 'Untitled', 50),
        t.updatedAt ? timeAgo(t.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'UPDATED']);
    });
}
