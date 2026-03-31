import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

export function registerDocCommands(task: Command) {
  // ── doc ──────────────────────────────────────────────

  const dc = task.command('doc').description('Manage task workspace documents');

  dc.command('create <id>')
    .description('Create a document and pin it to the task')
    .requiredOption('-t, --title <title>', 'Document title')
    .option('-b, --body <content>', 'Document content')
    .option('--parent <docId>', 'Parent document/folder ID')
    .option('--folder', 'Create as folder')
    .action(
      async (
        id: string,
        options: { body?: string; folder?: boolean; parent?: string; title: string },
      ) => {
        const client = await getTrpcClient();

        // Create document
        const fileType = options.folder ? 'custom/folder' : undefined;
        const content = options.body || '';
        const result = await client.document.createDocument.mutate({
          content,
          editorData: options.folder ? undefined : JSON.stringify({ content, type: 'doc' }),
          fileType,
          parentId: options.parent,
          title: options.title,
        });

        // Pin to task
        await client.task.pinDocument.mutate({
          documentId: result.id,
          pinnedBy: 'user',
          taskId: id,
        });

        const icon = options.folder ? '📁' : '📄';
        log.info(`${icon} Created & pinned: ${pc.bold(options.title)} ${pc.dim(result.id)}`);
      },
    );

  dc.command('pin <id> <documentId>')
    .description('Pin an existing document to a task')
    .action(async (id: string, documentId: string) => {
      const client = await getTrpcClient();
      await client.task.pinDocument.mutate({ documentId, pinnedBy: 'user', taskId: id });
      log.info(`Pinned ${pc.dim(documentId)} to ${pc.bold(id)}.`);
    });

  dc.command('unpin <id> <documentId>')
    .description('Unpin a document from a task')
    .action(async (id: string, documentId: string) => {
      const client = await getTrpcClient();
      await client.task.unpinDocument.mutate({ documentId, taskId: id });
      log.info(`Unpinned ${pc.dim(documentId)} from ${pc.bold(id)}.`);
    });

  dc.command('mv <id> <documentId> <folder>')
    .description('Move a document into a folder (auto-creates folder if not found)')
    .action(async (id: string, documentId: string, folder: string) => {
      const client = await getTrpcClient();

      // Check if folder is a document ID or a folder name
      let folderId = folder;
      if (!folder.startsWith('docs_')) {
        // folder is a name, find or create it
        const detail = await client.task.detail.query({ id });
        const folders = detail.data.workspace || [];

        // Search for existing folder by name
        const existingFolder = folders.find((f) => f.title === folder);

        if (existingFolder) {
          folderId = existingFolder.documentId;
        } else {
          // Create folder and pin to task
          const result = await client.document.createDocument.mutate({
            content: '',
            fileType: 'custom/folder',
            title: folder,
          });
          await client.task.pinDocument.mutate({
            documentId: result.id,
            pinnedBy: 'user',
            taskId: id,
          });
          folderId = result.id;
          log.info(`📁 Created folder: ${pc.bold(folder)} ${pc.dim(folderId)}`);
        }
      }

      // Move document into folder
      await client.document.updateDocument.mutate({ id: documentId, parentId: folderId });
      log.info(`Moved ${pc.dim(documentId)} → 📁 ${pc.bold(folder)}`);
    });
}
