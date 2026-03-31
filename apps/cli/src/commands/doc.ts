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
    .option('--source-type <type>', 'Filter by source type (file, web, api, topic)')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        fileType?: string;
        json?: string | boolean;
        limit?: string;
        sourceType?: string;
      }) => {
        const client = await getTrpcClient();
        const pageSize = Number.parseInt(options.limit || '30', 10);

        const query: { fileTypes?: string[]; pageSize: number; sourceTypes?: string[] } = {
          pageSize,
        };
        if (options.fileType) query.fileTypes = [options.fileType];
        if (options.sourceType) query.sourceTypes = [options.sourceType];
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
      },
    );

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
      if ((document as any).knowledgeBaseId) meta.push(`KB: ${(document as any).knowledgeBaseId}`);
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
    .option('--kb <id>', 'Knowledge base ID to associate with')
    .option('--file-type <type>', 'File type (e.g. custom/document, custom/folder)')
    .action(
      async (options: {
        body?: string;
        bodyFile?: string;
        fileType?: string;
        kb?: string;
        parent?: string;
        slug?: string;
        title: string;
      }) => {
        const content = readBodyContent(options);
        const client = await getTrpcClient();

        const result = await client.document.createDocument.mutate({
          content,
          editorData: JSON.stringify({ content: content || '', type: 'doc' }),
          fileType: options.fileType,
          knowledgeBaseId: options.kb,
          parentId: options.parent,
          slug: options.slug,
          title: options.title,
        });

        console.log(`${pc.green('✓')} Created document ${pc.bold(result.id)}`);
      },
    );

  // ── batch-create ───────────────────────────────────────

  doc
    .command('batch-create <file>')
    .description('Batch create documents from a JSON file')
    .action(async (file: string) => {
      if (!fs.existsSync(file)) {
        log.error(`File not found: ${file}`);
        process.exit(1);
        return;
      }

      let documents: any[];
      try {
        const raw = fs.readFileSync(file, 'utf8');
        documents = JSON.parse(raw);
      } catch {
        log.error('Failed to parse JSON file. Expected an array of document objects.');
        process.exit(1);
        return;
      }

      if (!Array.isArray(documents) || documents.length === 0) {
        log.error('JSON file must contain a non-empty array of document objects.');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();

      const items = documents.map((d) => ({
        content: d.content,
        editorData: JSON.stringify({ content: d.content || '', type: 'doc' }),
        fileType: d.fileType,
        knowledgeBaseId: d.knowledgeBaseId,
        parentId: d.parentId,
        slug: d.slug,
        title: d.title,
      }));

      const result = await client.document.createDocuments.mutate({ documents: items });
      const created = Array.isArray(result) ? result : [result];
      console.log(`${pc.green('✓')} Created ${created.length} document(s)`);
      for (const doc of created) {
        console.log(`  ${pc.dim('•')} ${doc.id} — ${doc.title || 'Untitled'}`);
      }
    });

  // ── edit ──────────────────────────────────────────────

  doc
    .command('edit <id>')
    .description('Edit a document')
    .option('-t, --title <title>', 'New title')
    .option('-b, --body <content>', 'New content')
    .option('-F, --body-file <path>', 'Read new content from file')
    .option('--parent <id>', 'Move to parent document (empty string for root)')
    .option('--file-type <type>', 'Change file type')
    .action(
      async (
        id: string,
        options: {
          body?: string;
          bodyFile?: string;
          fileType?: string;
          parent?: string;
          title?: string;
        },
      ) => {
        const content = readBodyContent(options);

        if (!options.title && !content && options.parent === undefined && !options.fileType) {
          log.error(
            'No changes specified. Use --title, --body, --body-file, --parent, or --file-type.',
          );
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
        if (options.fileType) params.fileType = options.fileType;

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

  // ── parse ─────────────────────────────────────────────

  doc
    .command('parse <fileId>')
    .description('Parse an uploaded file into a document')
    .option('--with-pages', 'Preserve page structure')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (fileId: string, options: { json?: string | boolean; withPages?: boolean }) => {
      const client = await getTrpcClient();

      const result = options.withPages
        ? await client.document.parseFileContent.mutate({ id: fileId })
        : await client.document.parseDocument.mutate({ id: fileId });

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      console.log(`${pc.green('✓')} Parsed file ${pc.bold(fileId)}`);
      if ((result as any).title) console.log(`  Title: ${(result as any).title}`);
      if ((result as any).content) {
        const preview = truncate((result as any).content, 200);
        console.log(`  Content: ${pc.dim(preview)}`);
      }
    });

  // ── link-topic ────────────────────────────────────────

  doc
    .command('link-topic <docId> <topicId>')
    .description('Associate a document with a topic')
    .action(async (docId: string, topicId: string) => {
      const client = await getTrpcClient();

      // Create the document via notebook router which handles topic association
      // First verify the document exists
      const document = await client.document.getDocumentById.query({ id: docId });
      if (!document) {
        log.error(`Document not found: ${docId}`);
        process.exit(1);
        return;
      }

      // Use notebook.createDocument to create a linked copy, associating with the topic
      const result = await client.notebook.createDocument.mutate({
        content: document.content || '',
        description: document.description || '',
        title: document.title || 'Untitled',
        topicId,
      });

      console.log(
        `${pc.green('✓')} Linked document ${pc.bold(result.id)} to topic ${pc.bold(topicId)}`,
      );
    });

  // ── topic-docs ────────────────────────────────────────

  doc
    .command('topic-docs <topicId>')
    .description('List documents associated with a topic')
    .option('--type <type>', 'Filter by document type (article, markdown, note, report)')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (topicId: string, options: { json?: string | boolean; type?: string }) => {
      const client = await getTrpcClient();

      const query: { topicId: string; type?: any } = { topicId };
      if (options.type) query.type = options.type;
      const result = await client.notebook.listDocuments.query(query);
      const docs = Array.isArray(result) ? result : ((result as any).data ?? []);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(docs, fields);
        return;
      }

      if (docs.length === 0) {
        console.log('No documents found for this topic.');
        return;
      }

      const rows = docs.map((d: any) => [
        d.id,
        truncate(d.title || 'Untitled', 120),
        d.fileType || '',
        d.updatedAt ? timeAgo(d.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'TYPE', 'UPDATED']);
    });
}
