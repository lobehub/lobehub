import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerKbCommand(program: Command) {
  const kb = program.command('kb').description('Manage knowledge bases');

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

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      console.log(pc.bold(result.name || 'Untitled'));
      const meta: string[] = [];
      if (result.description) meta.push(result.description);
      if ((result as any).updatedAt) meta.push(`Updated ${timeAgo((result as any).updatedAt)}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));

      // Show files if available
      if ((result as any).files && Array.isArray((result as any).files)) {
        const files = (result as any).files;
        if (files.length > 0) {
          console.log();
          console.log(pc.bold(`Files (${files.length}):`));
          const rows = files.map((f: any) => [
            f.id,
            truncate(f.name || f.filename || '', 50),
            f.fileType || '',
          ]);
          printTable(rows, ['ID', 'NAME', 'TYPE']);
        }
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

      const result = await client.knowledgeBase.createKnowledgeBase.mutate(input);
      console.log(`${pc.green('✓')} Created knowledge base ${pc.bold((result as any).id)}`);
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
}
