import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';

export function registerThreadCommand(program: Command) {
  const thread = program.command('thread').description('Manage message threads');

  // ── list ──────────────────────────────────────────────

  thread
    .command('list')
    .description('List threads by topic')
    .requiredOption('--topic-id <id>', 'Topic ID')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; topicId: string }) => {
      const client = await getTrpcClient();
      const result = await client.thread.getThreads.query({ topicId: options.topicId });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No threads found.');
        return;
      }

      const rows = items.map((t: any) => [
        t.id || '',
        truncate(t.title || 'Untitled', 50),
        t.type || '',
        t.updatedAt ? timeAgo(t.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'TYPE', 'UPDATED']);
    });

  // ── list-all ──────────────────────────────────────────

  thread
    .command('list-all')
    .description('List all threads for the current user')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.thread.getThread.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No threads found.');
        return;
      }

      const rows = items.map((t: any) => [
        t.id || '',
        truncate(t.title || 'Untitled', 50),
        t.type || '',
        t.topicId || '',
        t.updatedAt ? timeAgo(t.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'TYPE', 'TOPIC', 'UPDATED']);
    });

  // ── delete ────────────────────────────────────────────

  thread
    .command('delete <id>')
    .description('Delete a thread')
    .option('--remove-children', 'Also remove child messages')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { removeChildren?: boolean; yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this thread?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.thread.removeThread.mutate({
        id,
        removeChildren: options.removeChildren,
      });
      console.log(`${pc.green('✓')} Deleted thread ${pc.bold(id)}`);
    });
}
