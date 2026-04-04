import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm } from '../utils/format';
import { log } from '../utils/logger';

// Directories and files to exclude when scanning the workspace
const EXCLUDED_NAMES = new Set([
  '.idea',
  '.DS_Store',
  '.openclaw',
  'node_modules',
  '.git',
  '.vscode',
  '__pycache__',
  '.cache',
]);

/**
 * Recursively collect all files under `dir`, skipping excluded directories/files.
 * Returns paths relative to `baseDir`.
 */
function collectFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, fullPath));
    }
  }

  return results;
}

export function registerMigrateCommand(program: Command) {
  const migrate = program.command('migrate').description('Migrate data from external tools');

  migrate
    .command('openclaw')
    .description('Import OpenClaw workspace files as agent documents into LobeHub inbox')
    .option(
      '--source <path>',
      'Path to OpenClaw workspace',
      path.join(process.env.HOME || '~', '.openclaw', 'workspace'),
    )
    .option('--agent-id <id>', 'Target agent ID (defaults to inbox agent)')
    .option('--slug <slug>', 'Target agent slug (defaults to "inbox")', 'inbox')
    .option('--dry-run', 'Preview files without importing')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (options: {
        agentId?: string;
        dryRun?: boolean;
        slug: string;
        source: string;
        yes?: boolean;
      }) => {
        const workspacePath = path.resolve(options.source);

        // Validate source directory
        if (!fs.existsSync(workspacePath)) {
          log.error(`OpenClaw workspace not found: ${workspacePath}`);
          process.exit(1);
        }

        if (!fs.statSync(workspacePath).isDirectory()) {
          log.error(`Not a directory: ${workspacePath}`);
          process.exit(1);
        }

        // Collect files
        const files = collectFiles(workspacePath, workspacePath);

        if (files.length === 0) {
          log.info('No files found in workspace.');
          return;
        }

        console.log(
          `Found ${pc.bold(String(files.length))} file(s) in ${pc.dim(workspacePath)}:\n`,
        );
        for (const f of files) {
          console.log(`  ${pc.dim('•')} ${f}`);
        }
        console.log();

        if (options.dryRun) {
          log.info('Dry run — no changes made.');
          return;
        }

        // Confirm
        if (!options.yes) {
          const confirmed = await confirm(
            `Import ${files.length} file(s) as agent documents to the inbox?`,
          );
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();

        // Resolve agent ID
        let agentId = options.agentId;
        if (!agentId) {
          const agent = await (client as any).agent.getBuiltinAgent.query({
            slug: options.slug,
          });
          if (!agent) {
            log.error(`Agent not found for slug: ${options.slug}`);
            process.exit(1);
          }
          agentId = (agent as any).id || (agent as any).agentId;
        }

        console.log(`\nImporting to agent ${pc.bold(agentId!)}...\n`);

        let success = 0;
        let failed = 0;

        for (const relativePath of files) {
          const fullPath = path.join(workspacePath, relativePath);
          const content = fs.readFileSync(fullPath, 'utf8');
          // Use the relative path as the filename (with path separators preserved)
          const filename = relativePath;

          try {
            await (client as any).agentDocument.upsertDocument.mutate({
              agentId,
              content,
              filename,
            });
            console.log(`  ${pc.green('✓')} ${filename}`);
            success++;
          } catch (err: any) {
            console.log(`  ${pc.red('✗')} ${filename} — ${err.message || err}`);
            failed++;
          }
        }

        console.log();
        console.log(
          `${pc.green('✓')} Done: ${pc.bold(String(success))} imported` +
            (failed > 0 ? `, ${pc.red(String(failed))} failed` : ''),
        );
      },
    );
}
