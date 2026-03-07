import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerAgentCommand(program: Command) {
  const agent = program.command('agent').description('Manage agents');

  // ── list ──────────────────────────────────────────────

  agent
    .command('list')
    .description('List agents')
    .option('-L, --limit <n>', 'Maximum number of items', '30')
    .option('-k, --keyword <keyword>', 'Filter by keyword')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; keyword?: string; limit?: string }) => {
      const client = await getTrpcClient();

      const input: { keyword?: string; limit?: number; offset?: number } = {};
      if (options.keyword) input.keyword = options.keyword;
      if (options.limit) input.limit = Number.parseInt(options.limit, 10);

      const result = await client.agent.queryAgents.query(input);
      const items = Array.isArray(result) ? result : ((result as any).items ?? []);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No agents found.');
        return;
      }

      const rows = items.map((a: any) => [
        a.id || a.agentId || '',
        truncate(a.title || a.name || a.meta?.title || 'Untitled', 40),
        truncate(a.description || a.meta?.description || '', 50),
        a.model || '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'DESCRIPTION', 'MODEL']);
    });

  // ── view ──────────────────────────────────────────────

  agent
    .command('view <agentId>')
    .description('View agent configuration')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (agentId: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.agent.getAgentConfigById.query({ agentId });

      if (!result) {
        log.error(`Agent not found: ${agentId}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      console.log(pc.bold(r.title || r.meta?.title || 'Untitled'));
      const meta: string[] = [];
      if (r.description || r.meta?.description) meta.push(r.description || r.meta.description);
      if (r.model) meta.push(`Model: ${r.model}`);
      if (r.provider) meta.push(`Provider: ${r.provider}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));

      if (r.systemRole) {
        console.log();
        console.log(pc.bold('System Role:'));
        console.log(r.systemRole);
      }
    });

  // ── create ────────────────────────────────────────────

  agent
    .command('create')
    .description('Create a new agent')
    .option('-t, --title <title>', 'Agent title')
    .option('-d, --description <desc>', 'Agent description')
    .option('-m, --model <model>', 'Model ID')
    .option('-p, --provider <provider>', 'Provider ID')
    .option('-s, --system-role <role>', 'System role prompt')
    .option('--group <groupId>', 'Group ID')
    .action(
      async (options: {
        description?: string;
        group?: string;
        model?: string;
        provider?: string;
        systemRole?: string;
        title?: string;
      }) => {
        const client = await getTrpcClient();

        const config: Record<string, any> = {};
        if (options.title) config.title = options.title;
        if (options.description) config.description = options.description;
        if (options.model) config.model = options.model;
        if (options.provider) config.provider = options.provider;
        if (options.systemRole) config.systemRole = options.systemRole;

        const input: Record<string, any> = { config };
        if (options.group) input.groupId = options.group;

        const result = await client.agent.createAgent.mutate(input as any);
        const r = result as any;
        console.log(`${pc.green('✓')} Created agent ${pc.bold(r.agentId || r.id)}`);
        if (r.sessionId) console.log(`  Session: ${r.sessionId}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  agent
    .command('edit <agentId>')
    .description('Update agent configuration')
    .option('-t, --title <title>', 'New title')
    .option('-d, --description <desc>', 'New description')
    .option('-m, --model <model>', 'New model ID')
    .option('-p, --provider <provider>', 'New provider ID')
    .option('-s, --system-role <role>', 'New system role prompt')
    .action(
      async (
        agentId: string,
        options: {
          description?: string;
          model?: string;
          provider?: string;
          systemRole?: string;
          title?: string;
        },
      ) => {
        const value: Record<string, any> = {};
        if (options.title) value.title = options.title;
        if (options.description) value.description = options.description;
        if (options.model) value.model = options.model;
        if (options.provider) value.provider = options.provider;
        if (options.systemRole) value.systemRole = options.systemRole;

        if (Object.keys(value).length === 0) {
          log.error(
            'No changes specified. Use --title, --description, --model, --provider, or --system-role.',
          );
          process.exit(1);
        }

        const client = await getTrpcClient();
        await client.agent.updateAgentConfig.mutate({ agentId, value });
        console.log(`${pc.green('✓')} Updated agent ${pc.bold(agentId)}`);
      },
    );

  // ── delete ────────────────────────────────────────────

  agent
    .command('delete <agentId>')
    .description('Delete an agent')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (agentId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this agent?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.agent.removeAgent.mutate({ agentId });
      console.log(`${pc.green('✓')} Deleted agent ${pc.bold(agentId)}`);
    });

  // ── duplicate ─────────────────────────────────────────

  agent
    .command('duplicate <agentId>')
    .description('Duplicate an agent')
    .option('-t, --title <title>', 'Title for the duplicate')
    .action(async (agentId: string, options: { title?: string }) => {
      const client = await getTrpcClient();
      const input: Record<string, any> = { agentId };
      if (options.title) input.newTitle = options.title;

      const result = await client.agent.duplicateAgent.mutate(input as any);
      const r = result as any;
      console.log(`${pc.green('✓')} Duplicated agent → ${pc.bold(r.agentId || r.id || 'done')}`);
    });
}
