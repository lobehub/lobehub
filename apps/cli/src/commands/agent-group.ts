import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerAgentGroupCommand(program: Command) {
  const agentGroup = program.command('agent-group').description('Manage agent groups');

  // ── list ──────────────────────────────────────────────

  agentGroup
    .command('list')
    .description('List all agent groups')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const groups = await client.group.getGroups.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(groups, fields);
        return;
      }

      if (!groups || (groups as any[]).length === 0) {
        console.log('No agent groups found.');
        return;
      }

      const rows = (groups as any[]).map((g: any) => [
        g.id || '',
        truncate(g.title || 'Untitled', 40),
        String(g.agents?.length ?? 0),
      ]);

      printTable(rows, ['ID', 'TITLE', 'AGENTS']);
    });

  // ── view ──────────────────────────────────────────────

  agentGroup
    .command('view <id>')
    .description('View agent group details')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const detail = await client.group.getGroupDetail.query({ id });

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(detail, fields);
        return;
      }

      if (!detail) {
        log.error('Agent group not found.');
        process.exit(1);
      }

      const d = detail as any;
      console.log(`${pc.bold('ID:')}      ${d.id}`);
      console.log(`${pc.bold('Title:')}   ${d.title || 'Untitled'}`);
      if (d.description) console.log(`${pc.bold('Desc:')}    ${d.description}`);

      if (d.agents && d.agents.length > 0) {
        console.log(`\n${pc.bold('Agents:')}`);
        const rows = d.agents.map((a: any) => [
          a.id || '',
          truncate(a.title || 'Untitled', 30),
          a.role || '',
          a.enabled === false ? pc.dim('disabled') : pc.green('enabled'),
        ]);
        printTable(rows, ['ID', 'TITLE', 'ROLE', 'STATUS']);
      }
    });

  // ── create ────────────────────────────────────────────

  agentGroup
    .command('create')
    .description('Create an agent group')
    .requiredOption('-t, --title <title>', 'Group title')
    .option('-d, --description <desc>', 'Group description')
    .option('--json', 'Output JSON')
    .action(async (options: { description?: string; json?: boolean; title: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { title: options.title };
      if (options.description) input.description = options.description;

      const result = await client.group.createGroup.mutate(input as any);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const r = result as any;
      console.log(`${pc.green('✓')} Created agent group ${pc.bold(r.group?.id || '')}`);
    });

  // ── edit ───────────────────────────────────────────────

  agentGroup
    .command('edit <id>')
    .description('Update an agent group')
    .option('-t, --title <title>', 'Group title')
    .option('-d, --description <desc>', 'Group description')
    .action(async (id: string, options: { description?: string; title?: string }) => {
      const value: Record<string, any> = {};
      if (options.title) value.title = options.title;
      if (options.description) value.description = options.description;

      if (Object.keys(value).length === 0) {
        log.error('No changes specified. Use --title or --description.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.group.updateGroup.mutate({ id, value } as any);
      console.log(`${pc.green('✓')} Updated agent group ${pc.bold(id)}`);
    });

  // ── delete ────────────────────────────────────────────

  agentGroup
    .command('delete <id>')
    .description('Delete an agent group')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this agent group?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.group.deleteGroup.mutate({ id });
      console.log(`${pc.green('✓')} Deleted agent group ${pc.bold(id)}`);
    });

  // ── duplicate ─────────────────────────────────────────

  agentGroup
    .command('duplicate <id>')
    .description('Duplicate an agent group')
    .option('-t, --title <title>', 'New title for the duplicated group')
    .action(async (id: string, options: { title?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { groupId: id };
      if (options.title) input.newTitle = options.title;

      const result = await client.group.duplicateGroup.mutate(input as any);
      const r = result as any;
      console.log(`${pc.green('✓')} Duplicated agent group → ${pc.bold(r.groupId || r.id || '')}`);
    });

  // ── add-agents ────────────────────────────────────────

  agentGroup
    .command('add-agents <groupId>')
    .description('Add agents to a group')
    .requiredOption('--agent-ids <ids>', 'Comma-separated agent IDs')
    .action(async (groupId: string, options: { agentIds: string }) => {
      const agentIds = options.agentIds.split(',').map((s) => s.trim());

      const client = await getTrpcClient();
      await client.group.addAgentsToGroup.mutate({ agentIds, groupId });
      console.log(
        `${pc.green('✓')} Added ${agentIds.length} agent(s) to group ${pc.bold(groupId)}`,
      );
    });

  // ── remove-agents ─────────────────────────────────────

  agentGroup
    .command('remove-agents <groupId>')
    .description('Remove agents from a group')
    .requiredOption('--agent-ids <ids>', 'Comma-separated agent IDs')
    .option('--keep-virtual', 'Keep virtual agents instead of deleting them')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (
        groupId: string,
        options: { agentIds: string; keepVirtual?: boolean; yes?: boolean },
      ) => {
        const agentIds = options.agentIds.split(',').map((s) => s.trim());

        if (!options.yes) {
          const confirmed = await confirm(
            `Are you sure you want to remove ${agentIds.length} agent(s) from group?`,
          );
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();
        await client.group.removeAgentsFromGroup.mutate({
          agentIds,
          deleteVirtualAgents: !options.keepVirtual,
          groupId,
        });
        console.log(
          `${pc.green('✓')} Removed ${agentIds.length} agent(s) from group ${pc.bold(groupId)}`,
        );
      },
    );
}
