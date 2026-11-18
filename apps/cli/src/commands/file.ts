import type { FileListItem } from '@lobehub/sdk';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { getSdkClient } from '../api/sdk';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { uploadLocalFile } from '../utils/uploadLocalFile';
import { resolveUrlBuilder, resourcePath, withUrl, withUrls } from './resourceUrl';

/** `GET /knowledge-bases/{id}/files` accepts at most this many items per page. */
const REST_PAGE_SIZE_MAX = 100;

/** A library's files through the public REST API, walking cursor pages up to `limit`. */
async function listKnowledgeBaseFiles(knowledgeBaseId: string, limit: number) {
  const sdk = await getSdkClient();
  const items: FileListItem[] = [];
  const pages = sdk.paginate(
    sdk.knowledgeBases.listFiles,
    { path: { id: knowledgeBaseId }, query: { limit: Math.min(REST_PAGE_SIZE_MAX, limit) } },
    { maxItems: limit },
  );
  for await (const file of pages) items.push(file);

  return items;
}

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
      const limit = options.limit ? Number.parseInt(options.limit, 10) : 30;
      let items: any[];

      if (options.kbId && options.json === undefined) {
        // A library's files come from the public REST API. `--json` stays on
        // tRPC: REST rows nest chunking/embedding and carry no `userId`, so the
        // printed objects would change. The drive listing (no --kb-id) stays
        // too: `GET /files` has no "not filed in any library" filter and does
        // not hide chat attachments the way the drive does.
        items = await listKnowledgeBaseFiles(options.kbId, limit);
      } else {
        const client = await getTrpcClient();
        const input: any = {};
        if (options.kbId) input.knowledgeBaseId = options.kbId;
        if (options.limit) input.limit = limit;
        const result = await client.file.getFiles.query(input);
        items = Array.isArray(result) ? result : ((result as any).items ?? []);
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(
          withUrls(items, await resolveUrlBuilder(await getTrpcClient()), (item: any) =>
            resourcePath.file({ ...item, knowledgeBaseId: item.knowledgeBaseId ?? options.kbId }),
          ),
          fields,
        );
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
        outputJson(
          withUrl(result, await resolveUrlBuilder(client), resourcePath.file(result as any)),
          fields,
        );
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

  // ── upload ───────────────────────────────────────────

  file
    .command('upload [source]')
    .description('Upload a file from a local path or a URL')
    .option('-f, --file <path>', 'Local file path to upload')
    .option('--hash <hash>', 'File hash for deduplication check (URL mode)')
    .option('--name <name>', 'File name (URL mode)')
    .option('--type <type>', 'File MIME type (URL mode)')
    .option('--size <size>', 'File size in bytes (URL mode)')
    .option('--parent-id <id>', 'Parent folder ID')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        source: string | undefined,
        options: {
          file?: string;
          hash?: string;
          json?: string | boolean;
          name?: string;
          parentId?: string;
          size?: string;
          type?: string;
        },
      ) => {
        const isUrl = (value: string) =>
          value.startsWith('http://') || value.startsWith('https://');

        // Resolve the local file path: explicit --file, or a positional that is
        // not a URL (e.g. `lh file upload ./games_list.txt`).
        const localPath = options.file ?? (source && !isUrl(source) ? source : undefined);

        const client = await getTrpcClient();

        // ── Local file upload ──
        if (localPath) {
          let result;
          try {
            result = await uploadLocalFile(client, localPath, { parentId: options.parentId });
          } catch (error) {
            log.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
            return;
          }

          if (options.json !== undefined) {
            const fields = typeof options.json === 'string' ? options.json : undefined;
            outputJson(
              withUrl(result, await resolveUrlBuilder(client), resourcePath.file(result as any)),
              fields,
            );
            return;
          }

          const r = result as any;
          console.log(`${pc.green('✓')} File created: ${pc.bold(r.id || '')}`);
          if (r.url) console.log(`  URL: ${pc.dim(r.url)}`);
          return;
        }

        // ── URL upload ──
        if (!source) {
          log.error('Provide a local file path, --file <path>, or a URL to upload.');
          process.exit(1);
          return;
        }

        const url = source;

        // Check hash first if provided
        if (options.hash) {
          const check = await client.file.checkFileHash.mutate({ hash: options.hash });
          if ((check as any)?.isExist) {
            console.log(`${pc.yellow('!')} File with this hash already exists.`);
            if (options.json !== undefined) {
              outputJson(check);
            }
            return;
          }
        }

        const input: Record<string, any> = { url };
        if (options.name) input.name = options.name;
        if (options.type) input.fileType = options.type;
        if (options.size) input.size = Number.parseInt(options.size, 10);
        if (options.hash) input.hash = options.hash;
        if (options.parentId) input.parentId = options.parentId;

        const result = await client.file.createFile.mutate(input as any);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(
            withUrl(result, await resolveUrlBuilder(client), resourcePath.file(result as any)),
            fields,
          );
          return;
        }

        const r = result as any;
        console.log(`${pc.green('✓')} File created: ${pc.bold(r.id || '')}`);
        if (r.url) console.log(`  URL: ${pc.dim(r.url)}`);
      },
    );

  // ── edit ─────────────────────────────────────────────

  file
    .command('edit <id>')
    .description('Update file info (e.g. move to folder)')
    .option('--parent-id <id>', 'Move file to a folder (use "null" to unset)')
    .action(async (id: string, options: { parentId?: string }) => {
      if (!options.parentId) {
        log.error('No changes specified. Use --parent-id.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      const parentId = options.parentId === 'null' ? null : options.parentId;
      await client.file.updateFile.mutate({ id, parentId } as any);
      console.log(`${pc.green('✓')} Updated file ${pc.bold(id)}`);
    });

  // ── kb-items ────────────────────────────────────────

  file
    .command('kb-items <id>')
    .description('View knowledge base items associated with a file')
    .option('-L, --limit <n>', 'Maximum number of items', '30')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean; limit?: string }) => {
      const client = await getTrpcClient();
      const input: any = { fileId: id };
      if (options.limit) input.limit = Number.parseInt(options.limit, 10);

      const result = await client.file.getKnowledgeItems.query(input);
      const items = Array.isArray(result) ? result : ((result as any).items ?? []);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(withUrls(items, await resolveUrlBuilder(client), resourcePath.file), fields);
        return;
      }

      if (items.length === 0) {
        console.log('No knowledge items found.');
        return;
      }

      const rows = items.map((item: any) => [
        item.id || '',
        truncate(item.name || item.text || '', 60),
        item.type || '',
      ]);

      printTable(rows, ['ID', 'CONTENT', 'TYPE']);
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
        outputJson(withUrls(items, await resolveUrlBuilder(client), resourcePath.file), fields);
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
