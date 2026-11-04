import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveUrlBuilder, resourcePath, withUrl } from '../resourceUrl';

const VISIBILITIES = new Set(['private', 'public']);

const readVisibility = (value: string) => {
  if (!VISIBILITIES.has(value)) {
    throw new Error(`Invalid visibility "${value}". Must be one of: private, public`);
  }
  return value as 'private' | 'public';
};

export function registerSharingCommands(task: Command) {
  // ── visibility ──────────────────────────────────────────

  task
    .command('visibility <id> <visibility>')
    .description('Make a task private or public')
    .option('--take-ownership', "Make someone else's public task your own private task")
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        id: string,
        visibility: string,
        options: { json?: string | boolean; takeOwnership?: boolean },
      ) => {
        const target = readVisibility(visibility);
        const client = await getTrpcClient();
        const result = await client.task.updateVisibility.mutate({
          id,
          takeOwnership: options.takeOwnership,
          visibility: target,
        });

        if (options.json !== undefined) {
          outputJson(
            withUrl(result.data, await resolveUrlBuilder(client), resourcePath.task(result.data)),
            options.json,
          );
          return;
        }

        log.info(`Task ${pc.bold(result.data.identifier)} → ${target}`);
      },
    );

  // ── copy ──────────────────────────────────────────────
  // There is deliberately no `transfer`: the server refuses `transferTask` for
  // every caller and points at this copy, which clones the definition only.

  task
    .command('copy <id>')
    .description('Copy a task definition to a workspace (without its runs, documents or comments)')
    .requiredOption('--to <workspaceId>', 'Target workspace ID, or "personal"')
    .option('--visibility <visibility>', 'Visibility of the copy (private, public)')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (id: string, options: { json?: string | boolean; to: string; visibility?: string }) => {
        const targetVisibility = options.visibility
          ? readVisibility(options.visibility)
          : undefined;
        const client = await getTrpcClient();
        const result = await client.task.copyTaskToWorkspace.mutate({
          targetVisibility,
          targetWorkspaceId: options.to === 'personal' ? null : options.to,
          taskId: id,
        });

        if (options.json !== undefined) {
          outputJson(result, options.json);
          return;
        }

        log.info(
          `Task ${pc.bold(id)} copied to ${pc.bold(options.to)} as ${pc.bold(result.rootId)}.`,
        );
      },
    );

  // ── lock ──────────────────────────────────────────────

  const lock = task.command('lock').description('Inspect or hold the task edit lock');

  const describeLock = (state: { holderId?: string | null; lockedByOther?: boolean }) =>
    state.lockedByOther
      ? `Locked by ${pc.bold(state.holderId ?? 'another member')}.`
      : state.holderId
        ? 'Locked by you.'
        : 'Not locked.';

  lock
    .command('get <id>')
    .description('Show who holds the edit lock')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const state = await client.task.getTaskLock.query({ id });
      if (options.json !== undefined) {
        outputJson(state, options.json);
        return;
      }
      log.info(describeLock(state));
    });

  lock
    .command('acquire <id>')
    .description('Take the edit lock (expires unless renewed; no-op outside a workspace)')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const state = await client.task.acquireTaskLock.mutate({ id });
      if (state.lockedByOther) process.exitCode = 1;
      if (options.json !== undefined) {
        outputJson(state, options.json);
        return;
      }
      log.info(describeLock(state));
    });

  lock
    .command('release <id>')
    .description('Release your edit lock')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      await client.task.releaseTaskLock.mutate({ id });
      // The procedure returns nothing, and an expired lease may already belong
      // to another member, so read back what the lock is now.
      const state = await client.task.getTaskLock.query({ id });
      if (state.lockedByOther) process.exitCode = 1;
      if (options.json !== undefined) {
        outputJson(state, options.json);
        return;
      }
      log.info(describeLock(state));
    });
}
