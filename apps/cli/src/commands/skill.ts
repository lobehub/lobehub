import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerSkillCommand(program: Command) {
  const skill = program.command('skill').description('Manage agent skills');

  // ── list ──────────────────────────────────────────────

  skill
    .command('list')
    .description('List skills')
    .option('--source <source>', 'Filter by source: builtin, market, user')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; source?: string }) => {
      if (options.source && !['builtin', 'market', 'user'].includes(options.source)) {
        log.error('Invalid source. Must be one of: builtin, market, user');
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();

      const input: { source?: 'builtin' | 'market' | 'user' } = {};
      if (options.source) input.source = options.source as 'builtin' | 'market' | 'user';

      const result = await client.agentSkills.list.query(input);
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No skills found.');
        return;
      }

      const rows = items.map((s: any) => [
        s.id || '',
        truncate(s.name || '', 30),
        truncate(s.description || '', 40),
        s.source || '',
        s.identifier || '',
      ]);

      printTable(rows, ['ID', 'NAME', 'DESCRIPTION', 'SOURCE', 'IDENTIFIER']);
    });

  // ── view ──────────────────────────────────────────────

  skill
    .command('view <id>')
    .description('View skill details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.agentSkills.getById.query({ id });

      if (!result) {
        log.error(`Skill not found: ${id}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      console.log(pc.bold(r.name || 'Untitled'));
      const meta: string[] = [];
      if (r.description) meta.push(r.description);
      if (r.source) meta.push(`Source: ${r.source}`);
      if (r.identifier) meta.push(`ID: ${r.identifier}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));

      if (r.content) {
        console.log();
        console.log(pc.bold('Content:'));
        console.log(r.content);
      }
    });

  // ── create ────────────────────────────────────────────

  skill
    .command('create')
    .description('Create a user skill')
    .requiredOption('-n, --name <name>', 'Skill name')
    .requiredOption('-d, --description <desc>', 'Skill description')
    .requiredOption('-c, --content <content>', 'Skill content (prompt)')
    .option('-i, --identifier <id>', 'Custom identifier')
    .action(
      async (options: {
        content: string;
        description: string;
        identifier?: string;
        name: string;
      }) => {
        const client = await getTrpcClient();

        const input: {
          content: string;
          description: string;
          identifier?: string;
          name: string;
        } = {
          content: options.content,
          description: options.description,
          name: options.name,
        };
        if (options.identifier) input.identifier = options.identifier;

        const result = await client.agentSkills.create.mutate(input);
        const r = result as any;
        console.log(`${pc.green('✓')} Created skill ${pc.bold(r.id || r)}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  skill
    .command('edit <id>')
    .description('Update a skill')
    .option('-c, --content <content>', 'New content')
    .option('-n, --name <name>', 'New name (via manifest)')
    .option('-d, --description <desc>', 'New description (via manifest)')
    .action(
      async (id: string, options: { content?: string; description?: string; name?: string }) => {
        if (!options.content && !options.name && !options.description) {
          log.error('No changes specified. Use --content, --name, or --description.');
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();

        const input: Record<string, any> = { id };
        if (options.content) input.content = options.content;

        if (options.name || options.description) {
          const manifest: Record<string, any> = {};
          if (options.name) manifest.name = options.name;
          if (options.description) manifest.description = options.description;
          input.manifest = manifest;
        }

        await client.agentSkills.update.mutate(input as any);
        console.log(`${pc.green('✓')} Updated skill ${pc.bold(id)}`);
      },
    );

  // ── delete ────────────────────────────────────────────

  skill
    .command('delete <id>')
    .description('Delete a skill')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this skill?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.agentSkills.delete.mutate({ id });
      console.log(`${pc.green('✓')} Deleted skill ${pc.bold(id)}`);
    });

  // ── search ────────────────────────────────────────────

  skill
    .command('search <query>')
    .description('Search skills')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (query: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.agentSkills.search.query({ query });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No skills found.');
        return;
      }

      const rows = items.map((s: any) => [
        s.id || '',
        truncate(s.name || '', 30),
        truncate(s.description || '', 50),
      ]);

      printTable(rows, ['ID', 'NAME', 'DESCRIPTION']);
    });

  // ── import-github ─────────────────────────────────────

  skill
    .command('import-github')
    .description('Import a skill from GitHub')
    .requiredOption('--url <gitUrl>', 'GitHub repository URL')
    .option('--branch <branch>', 'Branch name')
    .action(async (options: { branch?: string; url: string }) => {
      const client = await getTrpcClient();

      const input: { branch?: string; gitUrl: string } = { gitUrl: options.url };
      if (options.branch) input.branch = options.branch;

      const result = await client.agentSkills.importFromGitHub.mutate(input);
      const r = result as any;
      console.log(`${pc.green('✓')} Imported skill from GitHub ${pc.bold(r.id || r.name || '')}`);
    });

  // ── import-url ────────────────────────────────────────

  skill
    .command('import-url')
    .description('Import a skill from a ZIP URL')
    .requiredOption('--url <zipUrl>', 'URL to skill ZIP file')
    .action(async (options: { url: string }) => {
      const client = await getTrpcClient();

      const result = await client.agentSkills.importFromUrl.mutate({ url: options.url });
      const r = result as any;
      console.log(`${pc.green('✓')} Imported skill from URL ${pc.bold(r.id || r.name || '')}`);
    });

  // ── import-market ─────────────────────────────────────

  skill
    .command('import-market')
    .description('Install a skill from the marketplace')
    .requiredOption('-i, --identifier <id>', 'Skill identifier in marketplace')
    .action(async (options: { identifier: string }) => {
      const client = await getTrpcClient();

      const result = await client.agentSkills.importFromMarket.mutate({
        identifier: options.identifier,
      });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Installed skill ${pc.bold(options.identifier)} ${r.id ? `(${r.id})` : ''}`,
      );
    });

  // ── resources ─────────────────────────────────────────

  skill
    .command('resources <id>')
    .description('List skill resource files')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.agentSkills.listResources.query({ id });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No resources found.');
        return;
      }

      const rows = items.map((r: any) => [
        truncate(r.path || r.name || '', 60),
        r.type || '',
        r.size ? `${Math.round(r.size / 1024)}KB` : '',
      ]);

      printTable(rows, ['PATH', 'TYPE', 'SIZE']);
    });

  // ── read-resource ─────────────────────────────────────

  skill
    .command('read-resource <id> <path>')
    .description('Read a skill resource file')
    .action(async (id: string, path: string) => {
      const client = await getTrpcClient();
      const result = await client.agentSkills.readResource.query({ id, path });

      if (!result) {
        log.error(`Resource not found: ${path}`);
        process.exit(1);
        return;
      }

      const r = result as any;
      if (r.content) {
        process.stdout.write(r.content);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    });
}
