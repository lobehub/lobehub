import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerFileCommand(program: Command) {
  const file = program.command('file').description('Manage files');

  // ── list ──────────────────────────────────────────────

  file
    .command('list')
    .description('List files')
    .option('--kb-id <id>', 'Filter by knowledge base ID')
    .option('-L, --limit <n>', 'Maximum number of items', '30')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; kbId?: string; limit?: string }) => {
      const client = await getTrpcClient();
      const input: any = {};
      if (options.kbId) input.knowledgeBaseId = options.kbId;
      if (options.limit) input.limit = Number.parseInt(options.limit, 10);

      const result = await client.file.getFiles.query(input);
      const items = Array.isArray(result) ? result : ((result as any).items ?? []);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No files found.');
        return;
      }

      const rows = items.map((f: any) => [
        f.id,
        truncate(f.name || f.filename || '', 50),
        f.fileType || '',
        f.size ? `${Math.round(f.size / 1024)}KB` : '',
        f.updatedAt ? timeAgo(f.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'NAME', 'TYPE', 'SIZE', 'UPDATED']);
    });

  // ── view ──────────────────────────────────────────────

  file
    .command('view <id>')
    .description('View file details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.file.getFileItemById.query({ id });

      if (!result) {
        log.error(`File not found: ${id}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      console.log(pc.bold(r.name || r.filename || 'Unknown'));
      const meta: string[] = [];
      if (r.fileType) meta.push(r.fileType);
      if (r.size) meta.push(`${Math.round(r.size / 1024)}KB`);
      if (r.updatedAt) meta.push(`Updated ${timeAgo(r.updatedAt)}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));

      if (r.chunkingStatus || r.embeddingStatus) {
        console.log();
        if (r.chunkingStatus) console.log(`  Chunking:  ${r.chunkingStatus}`);
        if (r.embeddingStatus) console.log(`  Embedding: ${r.embeddingStatus}`);
      }
    });

  // ── delete ────────────────────────────────────────────

  file
    .command('delete <ids...>')
    .description('Delete one or more files')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (ids: string[], options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(`Are you sure you want to delete ${ids.length} file(s)?`);
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      if (ids.length === 1) {
        await client.file.removeFile.mutate({ id: ids[0] });
      } else {
        await client.file.removeFiles.mutate({ ids });
      }

      console.log(`${pc.green('✓')} Deleted ${ids.length} file(s)`);
    });

  // ── recent ────────────────────────────────────────────

  file
    .command('recent')
    .description('List recently accessed files')
    .option('-L, --limit <n>', 'Number of items', '10')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; limit?: string }) => {
      const client = await getTrpcClient();
      const limit = Number.parseInt(options.limit || '10', 10);

      const result = await client.file.recentFiles.query({ limit });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No recent files.');
        return;
      }

      const rows = items.map((f: any) => [
        f.id,
        truncate(f.name || f.filename || '', 50),
        f.fileType || '',
        f.updatedAt ? timeAgo(f.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'NAME', 'TYPE', 'UPDATED']);
    });
}
