import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerCronCommand(program: Command) {
  const cron = program.command('cron').description('Manage agent cron jobs');

  // ── list ──────────────────────────────────────────────

  cron
    .command('list')
    .description('List cron jobs')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('--enabled', 'Only show enabled jobs')
    .option('--disabled', 'Only show disabled jobs')
    .option('-L, --limit <n>', 'Page size', '20')
    .option('--offset <n>', 'Offset', '0')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        agentId?: string;
        disabled?: boolean;
        enabled?: boolean;
        json?: string | boolean;
        limit?: string;
        offset?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.agentId) input.agentId = options.agentId;
        if (options.enabled) input.enabled = true;
        if (options.disabled) input.enabled = false;
        if (options.limit) input.limit = Number.parseInt(options.limit, 10);
        if (options.offset) input.offset = Number.parseInt(options.offset, 10);

        const result = await client.agentCronJob.list.query(input as any);
        const items = (result as any).data ?? [];

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(items, fields);
          return;
        }

        if (items.length === 0) {
          console.log('No cron jobs found.');
          return;
        }

        const rows = items.map((j: any) => [
          j.id || '',
          truncate(j.name || '', 30),
          j.schedule || '',
          j.enabled ? pc.green('enabled') : pc.dim('disabled'),
          `${j.executionCount ?? 0}/${j.maxExecutions ?? '∞'}`,
          j.updatedAt ? timeAgo(j.updatedAt) : '',
        ]);

        printTable(rows, ['ID', 'NAME', 'SCHEDULE', 'STATUS', 'EXECUTIONS', 'UPDATED']);
      },
    );

  // ── view ──────────────────────────────────────────────

  cron
    .command('view <id>')
    .description('View cron job details')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.agentCronJob.findById.query({ id });
      const job = (result as any).data;

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(job, fields);
        return;
      }

      if (!job) {
        log.error('Cron job not found.');
        process.exit(1);
      }

      console.log(`${pc.bold('ID:')}          ${job.id}`);
      console.log(`${pc.bold('Name:')}        ${job.name || ''}`);
      console.log(`${pc.bold('Agent ID:')}    ${job.agentId || ''}`);
      console.log(`${pc.bold('Schedule:')}    ${job.schedule || ''}`);
      console.log(
        `${pc.bold('Status:')}      ${job.enabled ? pc.green('enabled') : pc.dim('disabled')}`,
      );
      console.log(
        `${pc.bold('Executions:')}  ${job.executionCount ?? 0}/${job.maxExecutions ?? '∞'}`,
      );
      if (job.prompt) console.log(`${pc.bold('Prompt:')}      ${truncate(job.prompt, 80)}`);
      if (job.createdAt) console.log(`${pc.bold('Created:')}     ${timeAgo(job.createdAt)}`);
      if (job.updatedAt) console.log(`${pc.bold('Updated:')}     ${timeAgo(job.updatedAt)}`);
    });

  // ── create ────────────────────────────────────────────

  cron
    .command('create')
    .description('Create a cron job')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('-s, --schedule <cron>', 'Cron schedule expression')
    .option('-n, --name <name>', 'Job name')
    .option('-p, --prompt <prompt>', 'Prompt text')
    .option('--max-executions <n>', 'Maximum number of executions')
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        agentId: string;
        json?: boolean;
        maxExecutions?: string;
        name?: string;
        prompt?: string;
        schedule: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          agentId: options.agentId,
          cronPattern: options.schedule,
        };
        if (options.name) input.name = options.name;
        if (options.prompt) input.content = options.prompt;
        if (options.maxExecutions) input.maxExecutions = Number.parseInt(options.maxExecutions, 10);

        const result = await client.agentCronJob.create.mutate(input as any);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const data = (result as any).data;
        console.log(`${pc.green('✓')} Created cron job ${pc.bold(data?.id || '')}`);
      },
    );

  // ── edit ───────────────────────────────────────────────

  cron
    .command('edit <id>')
    .description('Update a cron job')
    .option('-n, --name <name>', 'Job name')
    .option('-s, --schedule <cron>', 'Cron schedule expression')
    .option('-p, --prompt <prompt>', 'Prompt text')
    .option('--max-executions <n>', 'Maximum number of executions')
    .option('--enable', 'Enable the job')
    .option('--disable', 'Disable the job')
    .action(
      async (
        id: string,
        options: {
          disable?: boolean;
          enable?: boolean;
          maxExecutions?: string;
          name?: string;
          prompt?: string;
          schedule?: string;
        },
      ) => {
        const data: Record<string, any> = {};
        if (options.name) data.name = options.name;
        if (options.schedule) data.cronPattern = options.schedule;
        if (options.prompt) data.content = options.prompt;
        if (options.maxExecutions) data.maxExecutions = Number.parseInt(options.maxExecutions, 10);
        if (options.enable) data.enabled = true;
        if (options.disable) data.enabled = false;

        if (Object.keys(data).length === 0) {
          log.error(
            'No changes specified. Use --name, --schedule, --prompt, --enable, or --disable.',
          );
          process.exit(1);
        }

        const client = await getTrpcClient();
        await client.agentCronJob.update.mutate({ data, id } as any);
        console.log(`${pc.green('✓')} Updated cron job ${pc.bold(id)}`);
      },
    );

  // ── delete ────────────────────────────────────────────

  cron
    .command('delete <id>')
    .description('Delete a cron job')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this cron job?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.agentCronJob.delete.mutate({ id });
      console.log(`${pc.green('✓')} Deleted cron job ${pc.bold(id)}`);
    });

  // ── toggle ────────────────────────────────────────────

  cron
    .command('toggle <ids...>')
    .description('Batch enable or disable cron jobs')
    .option('--enable', 'Enable the jobs')
    .option('--disable', 'Disable the jobs')
    .action(async (ids: string[], options: { disable?: boolean; enable?: boolean }) => {
      if (!options.enable && !options.disable) {
        log.error('Specify --enable or --disable.');
        process.exit(1);
      }

      const enabled = !!options.enable;
      const client = await getTrpcClient();
      const result = await client.agentCronJob.batchUpdateStatus.mutate({ enabled, ids });
      const count = (result as any).data?.updatedCount ?? ids.length;
      console.log(`${pc.green('✓')} ${enabled ? 'Enabled' : 'Disabled'} ${count} cron job(s)`);
    });

  // ── reset ─────────────────────────────────────────────

  cron
    .command('reset <id>')
    .description('Reset execution count for a cron job')
    .option('--max <n>', 'Set new max executions')
    .action(async (id: string, options: { max?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { id };
      if (options.max) input.newMaxExecutions = Number.parseInt(options.max, 10);

      await client.agentCronJob.resetExecutions.mutate(input as any);
      console.log(`${pc.green('✓')} Reset execution count for ${pc.bold(id)}`);
    });

  // ── stats ─────────────────────────────────────────────

  cron
    .command('stats')
    .description('Get cron job execution statistics')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.agentCronJob.getStats.query();
      const stats = (result as any).data;

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      if (!stats) {
        console.log('No statistics available.');
        return;
      }

      for (const [key, value] of Object.entries(stats as Record<string, any>)) {
        console.log(`${pc.bold(key + ':')} ${value}`);
      }
    });
}
