import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { confirm } from '../../utils/format';
import { log } from '../../utils/logger';

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

const OPENCLAW_AGENT_NAME = 'OpenClaw';

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

/**
 * Resolve the target agent ID. If --agent-id is given, use it directly.
 * Otherwise, create a new "OpenClaw" agent.
 */
async function resolveAgentId(client: TrpcClient, agentId?: string): Promise<string> {
  if (agentId) return agentId;

  log.info(`Creating new agent "${OPENCLAW_AGENT_NAME}"...`);
  const result = await client.agent.createAgent.mutate({
    config: { title: OPENCLAW_AGENT_NAME },
  });

  const id = result.agentId;
  if (!id) {
    log.error('Failed to create agent — no agentId returned.');
    process.exit(1);
  }

  console.log(`${pc.green('✓')} Agent created: ${pc.bold(id)}`);
  return id;
}

export function registerOpenClawMigration(migrate: Command) {
  migrate
    .command('openclaw')
    .description('Import OpenClaw workspace files as agent documents into a new "OpenClaw" agent')
    .option(
      '--source <path>',
      'Path to OpenClaw workspace',
      path.join(process.env.HOME || '~', '.openclaw', 'workspace'),
    )
    .option('--agent-id <id>', 'Import into an existing agent instead of creating a new one')
    .option('--dry-run', 'Preview files without importing')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (options: { agentId?: string; dryRun?: boolean; source: string; yes?: boolean }) => {
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
          const target = options.agentId
            ? `agent ${pc.bold(options.agentId)}`
            : `a new "${OPENCLAW_AGENT_NAME}" agent`;
          const confirmed = await confirm(
            `Import ${files.length} file(s) as agent documents into ${target}?`,
          );
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();

        // Create or reuse agent
        const agentId = await resolveAgentId(client, options.agentId);

        console.log(`\nImporting to agent ${pc.bold(agentId)}...\n`);

        let success = 0;
        let failed = 0;

        for (const relativePath of files) {
          const fullPath = path.join(workspacePath, relativePath);
          const content = fs.readFileSync(fullPath, 'utf8');
          const filename = relativePath;

          try {
            await client.agentDocument.upsertDocument.mutate({
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
