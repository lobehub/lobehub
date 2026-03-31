import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { outputJson, printTable, timeAgo } from '../../utils/format';
import { log } from '../../utils/logger';

export function registerDepCommands(task: Command) {
  // ── dep ──────────────────────────────────────────────

  const dep = task.command('dep').description('Manage task dependencies');

  dep
    .command('add <taskId> <dependsOnId>')
    .description('Add dependency (taskId blocks on dependsOnId)')
    .option('--type <type>', 'Dependency type (blocks/relates)', 'blocks')
    .action(async (taskId: string, dependsOnId: string, options: { type?: string }) => {
      const client = await getTrpcClient();
      await client.task.addDependency.mutate({
        dependsOnId,
        taskId,
        type: (options.type || 'blocks') as any,
      });
      log.info(`Dependency added: ${taskId} ${options.type || 'blocks'} on ${dependsOnId}`);
    });

  dep
    .command('rm <taskId> <dependsOnId>')
    .description('Remove dependency')
    .action(async (taskId: string, dependsOnId: string) => {
      const client = await getTrpcClient();
      await client.task.removeDependency.mutate({ dependsOnId, taskId });
      log.info(`Dependency removed.`);
    });

  dep
    .command('list <taskId>')
    .description('List dependencies for a task')
    .option('--json [fields]', 'Output JSON')
    .action(async (taskId: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.task.getDependencies.query({ id: taskId });

      if (options.json !== undefined) {
        outputJson(result.data, options.json);
        return;
      }

      if (!result.data || result.data.length === 0) {
        log.info('No dependencies.');
        return;
      }

      const rows = result.data.map((d: any) => [d.type, d.dependsOnId, timeAgo(d.createdAt)]);
      printTable(rows, ['TYPE', 'DEPENDS ON', 'CREATED']);
    });
}
