import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { confirm, outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveAssigneeUserId } from './assignee';
import { readFlag } from './model';

const RESOLVE_CONCURRENCY = 10;

interface BatchResult {
  failed: { error: string; id: string }[];
  followUpFailed?: boolean;
  skipped: { id: string; reason: string }[];
  updated: string[];
}

/**
 * The batch procedures only take raw ids: an identifier comes back as `notFound`
 * instead of being resolved. Resolve first, so a bad ref stops the whole command
 * before anything is written.
 */
export const resolveTaskIds = async (client: TrpcClient, refs: string[]) => {
  const unique = [...new Set(refs)];
  const ids: string[] = [];
  for (let i = 0; i < unique.length; i += RESOLVE_CONCURRENCY) {
    const chunk = unique.slice(i, i + RESOLVE_CONCURRENCY);
    ids.push(
      ...(await Promise.all(
        chunk.map(async (ref) =>
          ref.startsWith('task_') ? ref : (await client.task.find.query({ id: ref })).data.id,
        ),
      )),
    );
  }
  return ids;
};

const report = (result: BatchResult, verb: string, json: string | boolean | undefined) => {
  // Partial success is a normal outcome, but scripts still need to see failures.
  if (result.failed.length > 0) process.exitCode = 1;

  if (json !== undefined) {
    outputJson(result, json);
    return;
  }

  log.info(`${result.updated.length} task(s) ${verb}.`);
  for (const { id, reason } of result.skipped) {
    console.log(`  ${pc.yellow('skipped')} ${id} ${pc.dim(reason)}`);
  }
  for (const { error, id } of result.failed) {
    console.log(`  ${pc.red('failed')} ${id} ${pc.dim(error)}`);
  }
  if (result.followUpFailed) {
    log.warn('Tasks were completed, but their follow-ups (checkpoints, dependents) did not run.');
  }
};

export function registerBatchCommands(task: Command) {
  // ── batch ──────────────────────────────────────────────

  const batch = task.command('batch').description('Apply one change to many tasks');

  batch
    .command('archive <ids...>')
    .description('Archive tasks (hidden from lists; status unchanged)')
    .option('--undo', 'Restore the tasks to lists instead')
    .option('--json [fields]', 'Output JSON')
    .action(async (refs: string[], options: { json?: string | boolean; undo?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.task.batchArchive.mutate({
        archived: !options.undo,
        ids: await resolveTaskIds(client, refs),
      });
      report(result, options.undo ? 'unarchived' : 'archived', options.json);
    });

  batch
    .command('delete <ids...>')
    .description('Delete tasks')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json [fields]', 'Output JSON')
    .action(async (refs: string[], options: { json?: string | boolean; yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete ${pc.red(String(refs.length))} task(s)?`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      const result = await client.task.batchDelete.mutate({
        ids: await resolveTaskIds(client, refs),
      });
      report(result, 'deleted', options.json);
    });

  batch
    .command('update <ids...>')
    .description('Set the priority or assignee of tasks')
    .option('--priority <n>', 'Priority (0-4)')
    .option('--agent <id>', 'Assign to agent ("null" to unassign)')
    .option('--user <idOrEmail>', 'Assign to a workspace member ("null" to unassign)')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        refs: string[],
        options: { agent?: string; json?: string | boolean; priority?: string; user?: string },
      ) => {
        const user = readFlag(options.user);
        const agent = readFlag(options.agent);
        if (options.priority === undefined && agent === undefined && user === undefined) {
          throw new Error('Nothing to update. Pass --priority, --agent or --user.');
        }

        const client = await getTrpcClient();
        const result = await client.task.batchUpdate.mutate({
          assigneeAgentId: agent,
          assigneeUserId: user ? await resolveAssigneeUserId(client, user) : user,
          ids: await resolveTaskIds(client, refs),
          priority:
            options.priority === undefined ? undefined : Number.parseInt(options.priority, 10),
        });
        report(result, 'updated', options.json);
      },
    );

  batch
    .command('update-status <ids...>')
    .description('Set the status of tasks')
    .requiredOption('--status <status>', 'New status (backlog, paused, completed, canceled)')
    .option('--json [fields]', 'Output JSON')
    .action(async (refs: string[], options: { json?: string | boolean; status: string }) => {
      const client = await getTrpcClient();
      const result = await client.task.batchUpdateStatus.mutate({
        ids: await resolveTaskIds(client, refs),
        status: options.status as 'backlog' | 'canceled' | 'completed' | 'paused',
      });
      report(result, `moved to ${options.status}`, options.json);
    });
}
