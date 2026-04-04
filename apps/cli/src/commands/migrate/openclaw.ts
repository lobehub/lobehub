import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import ignore from 'ignore';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { resolveServerUrl } from '../../settings';
import { confirm } from '../../utils/format';
import { log } from '../../utils/logger';

const DEFAULT_AGENT_NAME = 'OpenClaw';

// Files to look for agent identity (tried in order)
const IDENTITY_FILES = ['IDENTITY.md', 'SOUL.md'];

// Default ignore rules (gitignore syntax) applied when no .gitignore is found
const DEFAULT_IGNORE_RULES = [
  // VCS
  '.git',
  '.svn',
  '.hg',

  // OpenClaw internal
  '.openclaw',

  // OS artifacts
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',

  // IDE / editor
  '.idea',
  '.vscode',
  '.fleet',
  '.cursor',
  '.zed',
  '*.swp',
  '*.swo',
  '*~',

  // Dependencies
  'node_modules',
  '.pnp',
  '.yarn',
  'bower_components',
  'vendor',
  'jspm_packages',

  // Python
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '*.pyc',
  '*.pyo',
  '.mypy_cache',
  '.ruff_cache',
  '.pytest_cache',
  '.tox',
  '.eggs',
  '*.egg-info',

  // Ruby
  '.bundle',

  // Rust
  'target',

  // Go
  'go.sum',

  // Java / JVM
  '.gradle',
  '.m2',

  // .NET
  'bin',
  'obj',
  'packages',

  // Build / cache / output
  '.cache',
  '.parcel-cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.output',
  'dist',
  'build',
  'out',
  '.sass-cache',

  // Env / secrets
  '.env',
  '.env.*',

  // Test / coverage
  'coverage',
  '.nyc_output',

  // Infra
  '.terraform',

  // Temp
  'tmp',
  '.tmp',

  // Logs
  '*.log',
  'logs',

  // Archives / binaries
  '*.zip',
  '*.tar',
  '*.tar.gz',
  '*.tgz',
  '*.rar',
  '*.7z',
  '*.jar',
  '*.war',
  '*.dll',
  '*.so',
  '*.dylib',
  '*.exe',
];

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
 * Build an ignore filter for the workspace. Uses .gitignore if present,
 * otherwise falls back to a comprehensive default rule set.
 */
function buildIgnoreFilter(workspacePath: string) {
  const ig = ignore();

  const gitignorePath = path.join(workspacePath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }

  // Always apply default rules on top
  ig.add(DEFAULT_IGNORE_RULES);

  return ig;
}

/**
 * Recursively collect all files under `dir`, filtered by ignore rules.
 * Returns paths relative to `baseDir`.
 */
function collectFiles(dir: string, baseDir: string, ig: ReturnType<typeof ignore>): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relativePath = path.relative(baseDir, path.join(dir, entry.name));

    // Directories need a trailing slash for ignore to match correctly
    const testPath = entry.isDirectory() ? `${relativePath}/` : relativePath;
    if (ig.ignores(testPath)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir, ig));
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }

  return results;
}

function formatAgentLabel(profile: AgentProfile): string {
  return profile.avatar ? `${profile.avatar} ${profile.title}` : profile.title;
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

  const label = formatAgentLabel(profile);
  log.info(`Creating new agent ${pc.bold(label)}...`);
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

  console.log(`${pc.green('✓')} Agent created: ${pc.bold(label)}`);
  return id;
}

export function registerOpenClawMigration(migrate: Command) {
  migrate
    .command('openclaw')
    .description('Import OpenClaw workspace files as agent documents')
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
        const label = formatAgentLabel(profile);

        // Collect files (respects .gitignore + default rules)
        const ig = buildIgnoreFilter(workspacePath);
        const files = collectFiles(workspacePath, workspacePath, ig);

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
              : `a new ${pc.bold(label)} agent`;
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

        console.log(`\nImporting to ${pc.bold(label)}...\n`);

        let success = 0;
        let failed = 0;

        for (const relativePath of files) {
          const fullPath = path.join(workspacePath, relativePath);
          const content = fs.readFileSync(fullPath, 'utf8');

          try {
            await client.agentDocument.upsertDocument.mutate({
              agentId,
              content,
              filename: relativePath,
            });
            console.log(`  ${pc.green('✓')} ${relativePath}`);
            success++;
          } catch (err: any) {
            console.log(`  ${pc.red('✗')} ${relativePath} — ${err.message || err}`);
            failed++;
          }
        }

        const agentUrl = `${resolveServerUrl()}/agent/${agentId}`;
        console.log();
        if (failed === 0) {
          console.log(
            `${pc.green('✓')} Migration complete! ${pc.bold(String(success))} file(s) imported to ${pc.bold(label)}.`,
          );
        } else {
          console.log(
            `${pc.yellow('⚠')} Migration finished with issues: ${pc.bold(String(success))} imported, ${pc.red(String(failed))} failed.`,
          );
        }
        console.log(`\n  ${pc.dim('→')} ${pc.underline(agentUrl)}`);
        console.log();
      },
    );
}
