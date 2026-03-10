import fs from 'node:fs';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

// ── Helpers ────────────────────────────────────────────────

function readBodyContent(options: { body?: string; bodyFile?: string }): string | undefined {
  if (options.bodyFile) {
    if (!fs.existsSync(options.bodyFile)) {
      log.error(`File not found: ${options.bodyFile}`);
      process.exit(1);
    }
    return fs.readFileSync(options.bodyFile, 'utf8');
  }
  return options.body;
}

// ── Command Registration ───────────────────────────────────

export function registerDocCommand(program: Command) {
  const doc = program.command('doc').description('Manage documents');

  // ── list ──────────────────────────────────────────────

  doc
    .command('list')
    .description('List documents')
    .option('-L, --limit <n>', 'Maximum number of items to fetch', '30')
    .option('--file-type <type>', 'Filter by file type')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { fileType?: string; json?: string | boolean; limit?: string }) => {
      const client = await getTrpcClient();
      const pageSize = Number.parseInt(options.limit || '30', 10);

      const query: { fileTypes?: string[]; pageSize: number } = { pageSize };
      if (options.fileType) query.fileTypes = [options.fileType];
      const result = await client.document.queryDocuments.query(query);
      const docs = Array.isArray(result) ? result : ((result as any).items ?? []);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(docs, fields);
        return;
      }

      if (docs.length === 0) {
        console.log('No documents found.');
        return;
      }

      const rows = docs.map((d: any) => [
        d.id,
        truncate(d.title || d.filename || 'Untitled', 120),
        d.fileType || '',
        d.updatedAt ? timeAgo(d.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'TYPE', 'UPDATED']);
    });

  // ── view ──────────────────────────────────────────────

  doc
    .command('view <id>')
    .description('View a document')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const document = await client.document.getDocumentById.query({ id });

      if (!document) {
        log.error(`Document not found: ${id}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(document, fields);
        return;
      }

      // Human-readable output
      console.log(pc.bold(document.title || 'Untitled'));
      const meta: string[] = [];
      if (document.fileType) meta.push(document.fileType);
      if (document.updatedAt) meta.push(`Updated ${timeAgo(document.updatedAt)}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));
      console.log();

      if (document.content) {
        console.log(document.content);
      } else {
        console.log(pc.dim('(no content)'));
      }
    });

  // ── create ────────────────────────────────────────────

  doc
    .command('create')
    .description('Create a new document')
    .requiredOption('-t, --title <title>', 'Document title')
    .option('-b, --body <content>', 'Document content')
    .option('-F, --body-file <path>', 'Read content from file')
    .option('--parent <id>', 'Parent document or folder ID')
    .option('--slug <slug>', 'Custom slug')
    .action(
      async (options: {
        body?: string;
        bodyFile?: string;
        parent?: string;
        slug?: string;
        title: string;
      }) => {
        const content = readBodyContent(options);
        const client = await getTrpcClient();

        const result = await client.document.createDocument.mutate({
          content,
          editorData: JSON.stringify({ content: content || '', type: 'doc' }),
          parentId: options.parent,
          slug: options.slug,
          title: options.title,
        });

        console.log(`${pc.green('✓')} Created document ${pc.bold(result.id)}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  doc
    .command('edit <id>')
    .description('Edit a document')
    .option('-t, --title <title>', 'New title')
    .option('-b, --body <content>', 'New content')
    .option('-F, --body-file <path>', 'Read new content from file')
    .option('--parent <id>', 'Move to parent document (empty string for root)')
    .action(
      async (
        id: string,
        options: { body?: string; bodyFile?: string; parent?: string; title?: string },
      ) => {
        const content = readBodyContent(options);

        if (!options.title && !content && options.parent === undefined) {
          log.error('No changes specified. Use --title, --body, --body-file, or --parent.');
          process.exit(1);
        }

        const client = await getTrpcClient();

        const params: Record<string, any> = { id };
        if (options.title) params.title = options.title;
        if (content !== undefined) {
          params.content = content;
          params.editorData = JSON.stringify({ content, type: 'doc' });
        }
        if (options.parent !== undefined) {
          params.parentId = options.parent || null;
        }

        await client.document.updateDocument.mutate(params as any);
        console.log(`${pc.green('✓')} Updated document ${pc.bold(id)}`);
      },
    );

  // ── delete ────────────────────────────────────────────

  doc
    .command('delete <ids...>')
    .description('Delete one or more documents')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (ids: string[], options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(
          `Are you sure you want to delete ${ids.length} document(s)?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      if (ids.length === 1) {
        await client.document.deleteDocument.mutate({ id: ids[0] });
      } else {
        await client.document.deleteDocuments.mutate({ ids });
      }

      console.log(`${pc.green('✓')} Deleted ${ids.length} document(s)`);
    });
}
