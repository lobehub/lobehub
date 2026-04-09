import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { getAuthInfo } from '../api/http';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

function formatFileType(fileType: string): string {
  if (!fileType) return '';
  // Simplify common MIME types to readable short names
  const map: Record<string, string> = {
    'application/msword': 'doc',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'custom/folder': 'folder',
    'text/markdown': 'md',
    'text/plain': 'txt',
  };
  if (map[fileType]) return map[fileType];
  // For other types, extract subtype (e.g. "image/png" → "png")
  const parts = fileType.split('/');
  return parts.length > 1 ? parts[1] : fileType;
}

export function registerKbCommand(program: Command) {
  const kb = program
    .command('kb')
    .description('Manage knowledge bases, folders, documents, and files');

  // ── list ──────────────────────────────────────────────

  kb.command('list')
    .description('List knowledge bases')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.knowledgeBase.getKnowledgeBases.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No knowledge bases found.');
        return;
      }

      const rows = items.map((kb: any) => [
        kb.id,
        truncate(kb.name || 'Untitled', 40),
        truncate(kb.description || '', 50),
        kb.updatedAt ? timeAgo(kb.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'NAME', 'DESCRIPTION', 'UPDATED']);
    });

  // ── view ──────────────────────────────────────────────

  kb.command('view <id>')
    .description('View a knowledge base')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.knowledgeBase.getKnowledgeBaseById.query({ id });

      if (!result) {
        log.error(`Knowledge base not found: ${id}`);
        process.exit(1);
        return;
      }

      // Recursively fetch all items in the knowledge base (with pagination)
      const allItems: any[] = [];
      async function fetchItems(parentId: string | null, depth = 0) {
        const PAGE_SIZE = 100;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const query: any = { knowledgeBaseId: id, limit: PAGE_SIZE, offset, parentId };
          const result = await client.file.getKnowledgeItems.query(query);
          const list = Array.isArray(result) ? result : ((result as any).items ?? []);
          hasMore = Array.isArray(result) ? false : ((result as any).hasMore ?? false);
          offset += list.length;

          // Collect folders for parallel recursive fetch
          const folders: any[] = [];
          for (const item of list) {
            allItems.push({ ...item, _depth: depth });
            if (item.fileType === 'custom/folder') {
              folders.push(item);
            }
          }

          // Fetch all sub-folders in parallel
          if (folders.length > 0) {
            await Promise.all(folders.map((f) => fetchItems(f.id, depth + 1)));
          }
        }
      }
      await fetchItems(null);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson({ ...result, files: allItems }, fields);
        return;
      }

      console.log(pc.bold(result.name || 'Untitled'));
      const meta: string[] = [];
      if (result.description) meta.push(result.description);
      if ((result as any).updatedAt) meta.push(`Updated ${timeAgo((result as any).updatedAt)}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));

      if (allItems.length > 0) {
        console.log();
        console.log(pc.bold(`Items (${allItems.length}):`));
        const rows = allItems.map((f: any) => {
          const indent = '  '.repeat(f._depth);
          const name = f.name || f.filename || '';
          return [
            f.id,
            f.sourceType === 'document' ? 'Doc' : 'File',
            truncate(`${indent}${name}`, 45),
            formatFileType(f.fileType || ''),
            f.size ? `${Math.round(f.size / 1024)}KB` : '',
          ];
        });
        printTable(rows, ['ID', 'SOURCE', 'NAME', 'TYPE', 'SIZE']);
      } else {
        console.log(pc.dim('\nNo files in this knowledge base.'));
      }
    });

  // ── create ────────────────────────────────────────────

  kb.command('create')
    .description('Create a knowledge base')
    .requiredOption('-n, --name <name>', 'Knowledge base name')
    .option('-d, --description <desc>', 'Description')
    .option('--avatar <url>', 'Avatar URL')
    .action(async (options: { avatar?: string; description?: string; name: string }) => {
      const client = await getTrpcClient();

      const input: { avatar?: string; description?: string; name: string } = {
        name: options.name,
      };
      if (options.description) input.description = options.description;
      if (options.avatar) input.avatar = options.avatar;

      const id = await client.knowledgeBase.createKnowledgeBase.mutate(input);
      console.log(`${pc.green('✓')} Created knowledge base ${pc.bold(String(id))}`);
    });

  // ── edit ──────────────────────────────────────────────

  kb.command('edit <id>')
    .description('Update a knowledge base')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <desc>', 'New description')
    .option('--avatar <url>', 'New avatar URL')
    .action(
      async (id: string, options: { avatar?: string; description?: string; name?: string }) => {
        if (!options.name && !options.description && !options.avatar) {
          log.error('No changes specified. Use --name, --description, or --avatar.');
          process.exit(1);
        }

        const client = await getTrpcClient();

        const value: Record<string, any> = {};
        if (options.name) value.name = options.name;
        if (options.description) value.description = options.description;
        if (options.avatar) value.avatar = options.avatar;

        await client.knowledgeBase.updateKnowledgeBase.mutate({ id, value });
        console.log(`${pc.green('✓')} Updated knowledge base ${pc.bold(id)}`);
      },
    );

  // ── delete ────────────────────────────────────────────

  kb.command('delete <id>')
    .description('Delete a knowledge base')
    .option('--remove-files', 'Also delete associated files')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { removeFiles?: boolean; yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this knowledge base?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.knowledgeBase.removeKnowledgeBase.mutate({
        id,
        removeFiles: options.removeFiles,
      });
      console.log(`${pc.green('✓')} Deleted knowledge base ${pc.bold(id)}`);
    });

  // ── add-files ─────────────────────────────────────────

  kb.command('add-files <knowledgeBaseId>')
    .description('Add files to a knowledge base')
    .requiredOption('--ids <ids...>', 'File IDs to add')
    .action(async (knowledgeBaseId: string, options: { ids: string[] }) => {
      const client = await getTrpcClient();
      await client.knowledgeBase.addFilesToKnowledgeBase.mutate({
        ids: options.ids,
        knowledgeBaseId,
      });
      console.log(
        `${pc.green('✓')} Added ${options.ids.length} file(s) to knowledge base ${pc.bold(knowledgeBaseId)}`,
      );
    });

  // ── remove-files ──────────────────────────────────────

  kb.command('remove-files <knowledgeBaseId>')
    .description('Remove files from a knowledge base')
    .requiredOption('--ids <ids...>', 'File IDs to remove')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (knowledgeBaseId: string, options: { ids: string[]; yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm(
          `Remove ${options.ids.length} file(s) from knowledge base?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.knowledgeBase.removeFilesFromKnowledgeBase.mutate({
        ids: options.ids,
        knowledgeBaseId,
      });
      console.log(
        `${pc.green('✓')} Removed ${options.ids.length} file(s) from knowledge base ${pc.bold(knowledgeBaseId)}`,
      );
    });

  // ── mkdir ───────────────────────────────────────────

  kb.command('mkdir <knowledgeBaseId>')
    .description('Create a folder in a knowledge base')
    .requiredOption('-n, --name <name>', 'Folder name')
    .option('--parent <parentId>', 'Parent folder ID')
    .action(async (knowledgeBaseId: string, options: { name: string; parent?: string }) => {
      const client = await getTrpcClient();
      const result = await client.document.createDocument.mutate({
        editorData: JSON.stringify({}),
        fileType: 'custom/folder',
        knowledgeBaseId,
        parentId: options.parent,
        title: options.name,
      });
      console.log(`${pc.green('✓')} Created folder ${pc.bold((result as any).id)}`);
    });

  // ── create-doc ──────────────────────────────────────

  kb.command('create-doc <knowledgeBaseId>')
    .description('Create a document in a knowledge base')
    .requiredOption('-t, --title <title>', 'Document title')
    .option('-c, --content <content>', 'Document content (text)')
    .option('--parent <parentId>', 'Parent folder ID')
    .action(
      async (
        knowledgeBaseId: string,
        options: { content?: string; parent?: string; title: string },
      ) => {
        const client = await getTrpcClient();
        const result = await client.document.createDocument.mutate({
          content: options.content,
          editorData: JSON.stringify({}),
          fileType: 'custom/document',
          knowledgeBaseId,
          parentId: options.parent,
          title: options.title,
        });
        console.log(`${pc.green('✓')} Created document ${pc.bold((result as any).id)}`);
      },
    );

  // ── move ────────────────────────────────────────────

  kb.command('move <id>')
    .description('Move a file or document to a different folder')
    .option('--parent <parentId>', 'Target folder ID (omit to move to root)')
    .option('--type <type>', 'Item type: file or doc', 'file')
    .action(async (id: string, options: { parent?: string; type: string }) => {
      const client = await getTrpcClient();
      const parentId = options.parent ?? null;

      if (options.type === 'doc') {
        await client.document.updateDocument.mutate({ id, parentId });
      } else {
        await client.file.updateFile.mutate({ id, parentId });
      }

      const dest = parentId ? `folder ${pc.bold(parentId)}` : 'root';
      console.log(`${pc.green('✓')} Moved ${pc.bold(id)} to ${dest}`);
    });

  // ── upload ──────────────────────────────────────────

  kb.command('upload <knowledgeBaseId> <filePath>')
    .description('Upload a file to a knowledge base')
    .option('--parent <parentId>', 'Parent folder ID')
    .action(async (knowledgeBaseId: string, filePath: string, options: { parent?: string }) => {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        log.error(`File not found: ${resolved}`);
        process.exit(1);
      }

      const stat = fs.statSync(resolved);
      const fileName = path.basename(resolved);
      const fileBuffer = fs.readFileSync(resolved);

      // Compute SHA-256 hash
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Detect MIME type from extension
      const ext = path.extname(fileName).toLowerCase().slice(1);
      const mimeMap: Record<string, string> = {
        csv: 'text/csv',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        gif: 'image/gif',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        json: 'application/json',
        md: 'text/markdown',
        mp3: 'audio/mpeg',
        mp4: 'video/mp4',
        pdf: 'application/pdf',
        png: 'image/png',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        svg: 'image/svg+xml',
        txt: 'text/plain',
        webp: 'image/webp',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      const fileType = mimeMap[ext] || 'application/octet-stream';

      const client = await getTrpcClient();
      const { serverUrl, headers } = await getAuthInfo();

      // 1. Get presigned URL
      const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
      const pathname = `files/${date}/${hash}.${ext}`;
      const presigned = await client.upload.createS3PreSignedUrl.mutate({ pathname });

      // 2. Upload to S3
      const presignedUrl = typeof presigned === 'string' ? presigned : (presigned as any).url;
      const uploadRes = await fetch(presignedUrl, {
        body: fileBuffer,
        headers: { 'Content-Type': fileType },
        method: 'PUT',
      });
      if (!uploadRes.ok) {
        log.error(`Upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
        process.exit(1);
      }

      // 3. Create file record
      const result = await client.file.createFile.mutate({
        fileType,
        hash,
        knowledgeBaseId,
        metadata: {
          date,
          dirname: '',
          filename: fileName,
          path: pathname,
        },
        name: fileName,
        parentId: options.parent,
        size: stat.size,
        url: pathname,
      });

      console.log(
        `${pc.green('✓')} Uploaded ${pc.bold(fileName)} → ${pc.bold((result as any).id)}`,
      );
    });
}
