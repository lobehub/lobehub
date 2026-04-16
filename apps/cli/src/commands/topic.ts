import fs from 'node:fs';

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
    .option('-L, --limit <n>', 'Page size', '30')
    .option('-P, --page <n>', 'Page number', '1')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        agentId?: string;
        json?: string | boolean;
        limit?: string;
        page?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.agentId) input.agentId = options.agentId;
        if (options.limit) input.pageSize = Number.parseInt(options.limit, 10);
        const page = options.page ? Number.parseInt(options.page, 10) : undefined;
        if (page !== undefined && page > 1) input.current = page - 1;

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
    .option('--favorite', 'Mark as favorite')
    .action(async (options: { agentId?: string; favorite?: boolean; title: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { title: options.title };
      if (options.agentId) input.agentId = options.agentId;
      if (options.favorite) input.favorite = true;

      const result = await client.topic.createTopic.mutate(input as any);
      const r = result as any;
      console.log(`${pc.green('✓')} Created topic ${pc.bold(r.id || r)}`);
    });

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
    .command('delete [ids...]')
    .description('Delete one or more topics (pass IDs as args or via --file)')
    .option('-f, --file <path>', 'Read topic IDs from a file (one per line, or a JSON array)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (ids: string[], options: { file?: string; yes?: boolean }) => {
      let allIds = [...ids];

      if (options.file) {
        const content = fs.readFileSync(options.file, 'utf8').trim();
        let fileIds: string[];
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            fileIds = parsed.map(String).filter(Boolean);
          } else {
            log.error('JSON file must contain an array of topic IDs.');
            process.exit(1);
          }
        } catch {
          // Not JSON, treat as one ID per line
          fileIds = content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
        allIds = [...allIds, ...fileIds];
      }

      if (allIds.length === 0) {
        log.error('No topic IDs provided. Pass IDs as arguments or use --file.');
        process.exit(1);
      }

      // Deduplicate
      allIds = [...new Set(allIds)];

      if (!options.yes) {
        const confirmed = await confirm(
          `Are you sure you want to delete ${allIds.length} topic(s)?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      if (allIds.length === 1) {
        await client.topic.removeTopic.mutate({ id: allIds[0] });
      } else {
        await client.topic.batchDelete.mutate({ ids: allIds });
      }

      console.log(`${pc.green('✓')} Deleted ${allIds.length} topic(s)`);
    });

  // ── clone ───────────────────────────────────────────

  topic
    .command('clone <id>')
    .description('Clone a topic')
    .option('-t, --title <title>', 'New title for the cloned topic')
    .action(async (id: string, options: { title?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { id };
      if (options.title) input.newTitle = options.title;

      const newId = await client.topic.cloneTopic.mutate(input as any);
      console.log(`${pc.green('✓')} Cloned topic → ${pc.bold(String(newId || ''))}`);
    });

  // ── share ──────────────────────────────────────────

  topic
    .command('share <id>')
    .description('Enable sharing for a topic')
    .option('--visibility <v>', 'Visibility: private or link', 'link')
    .action(async (id: string, options: { visibility?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { topicId: id };
      if (options.visibility) input.visibility = options.visibility;

      const result = await client.topic.enableSharing.mutate(input as any);
      const r = result as any;

      console.log(`${pc.green('✓')} Sharing enabled for topic ${pc.bold(id)}`);
      if (r.shareId) {
        console.log(`  Share ID: ${pc.bold(r.shareId)}`);
      }
    });

  // ── unshare ────────────────────────────────────────

  topic
    .command('unshare <id>')
    .description('Disable sharing for a topic')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      await client.topic.disableSharing.mutate({ topicId: id });
      console.log(`${pc.green('✓')} Sharing disabled for topic ${pc.bold(id)}`);
    });

  // ── share-info ─────────────────────────────────────

  topic
    .command('share-info <id>')
    .description('View sharing info for a topic')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const info = await client.topic.getShareInfo.query({ topicId: id });

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      if (!info) {
        console.log('Sharing not enabled for this topic.');
        return;
      }

      const i = info as any;
      console.log(`${pc.bold('Topic ID:')}    ${id}`);
      if (i.shareId) console.log(`${pc.bold('Share ID:')}    ${i.shareId}`);
      if (i.visibility) console.log(`${pc.bold('Visibility:')}  ${i.visibility}`);
      if (i.createdAt) console.log(`${pc.bold('Created:')}     ${i.createdAt}`);
    });

  // ── import ─────────────────────────────────────────

  topic
    .command('import')
    .description('Import a topic')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--data <json>', 'Topic data as JSON string')
    .option('--group-id <id>', 'Group ID')
    .option('--json', 'Output JSON')
    .action(
      async (options: { agentId: string; data: string; groupId?: string; json?: boolean }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          agentId: options.agentId,
          data: options.data,
        };
        if (options.groupId) input.groupId = options.groupId;

        const result = await client.topic.importTopic.mutate(input as any);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`${pc.green('✓')} Topic imported successfully`);
      },
    );

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
