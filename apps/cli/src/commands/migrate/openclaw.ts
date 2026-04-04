import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { resolveServerUrl } from '../../settings';
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

const DEFAULT_AGENT_NAME = 'OpenClaw';

// Files to look for agent identity (tried in order)
const IDENTITY_FILES = ['IDENTITY.md', 'SOUL.md'];

interface AgentProfile {
  avatar?: string;
  description?: string;
  title: string;
}

/**
 * Try to extract the agent name, description, and avatar emoji from
 * IDENTITY.md or SOUL.md. Falls back to "OpenClaw" if neither file
 * exists or parsing fails.
 */
function readAgentProfile(workspacePath: string): AgentProfile {
  for (const filename of IDENTITY_FILES) {
    const filePath = path.join(workspacePath, filename);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');

    // Try to extract **Name:** value
    const nameMatch = content.match(/\*{0,2}Name:?\*{0,2}\s*(.+)/i);
    const title = nameMatch ? nameMatch[1].trim() : DEFAULT_AGENT_NAME;

    // Try to extract **Creature:** or **Vibe:** or **Description:** as description
    const descMatch = content.match(/\*{0,2}(?:Creature|Vibe|Description):?\*{0,2}\s*(.+)/i);
    const description = descMatch ? descMatch[1].trim() : undefined;

    // Try to extract **Emoji:** value (single emoji)
    const emojiMatch = content.match(/\*{0,2}Emoji:?\*{0,2}\s*(.+)/i);
    const avatar = emojiMatch ? emojiMatch[1].trim() : undefined;

    return { avatar, description, title };
  }

  return { title: DEFAULT_AGENT_NAME };
}

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
 * Resolve the target agent ID.
 * Priority: --agent-id > --slug > create new agent from workspace profile.
 */
async function resolveAgentId(
  client: TrpcClient,
  opts: { agentId?: string; slug?: string },
  profile: AgentProfile,
): Promise<string> {
  if (opts.agentId) return opts.agentId;

  if (opts.slug) {
    const agent = await client.agent.getBuiltinAgent.query({ slug: opts.slug });
    if (!agent) {
      log.error(`Agent not found for slug: ${opts.slug}`);
      process.exit(1);
    }
    return agent.id;
  }

  log.info(`Creating new agent "${profile.title}"...`);
  const result = await client.agent.createAgent.mutate({
    config: {
      avatar: profile.avatar,
      description: profile.description,
      title: profile.title,
    },
  });

  const id = result.agentId;
  if (!id) {
    log.error('Failed to create agent — no agentId returned.');
    process.exit(1);
  }

  console.log(`${pc.green('✓')} Agent created: ${pc.bold(profile.title)} (${id})`);
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
    .option('--agent-id <id>', 'Import into an existing agent by ID')
    .option('--slug <slug>', 'Import into an existing agent by slug (e.g. "inbox")')
    .option('--dry-run', 'Preview files without importing')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (options: {
        agentId?: string;
        dryRun?: boolean;
        slug?: string;
        source: string;
        yes?: boolean;
      }) => {
        // Check auth early so users don't scan files only to find out they're not logged in
        if (!options.dryRun) {
          await getTrpcClient();
        }

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

        // Read agent profile from workspace identity files
        const profile = readAgentProfile(workspacePath);

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
            : options.slug
              ? `agent slug "${pc.bold(options.slug)}"`
              : `a new "${profile.title}" agent`;
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
        const agentId = await resolveAgentId(client, options, profile);

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

        const agentUrl = `${resolveServerUrl()}/agent/${agentId}`;
        console.log(`\n${pc.bold('Open agent:')} ${pc.underline(agentUrl)}`);
      },
    );
}
