import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceRef } from '../../api/workspaceRef';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';

/** Print a refusal and exit 1 instead of a stack trace. */
const run = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (error) {
    log.error((error as Error).message);
    process.exit(1);
  }
};

const WORKSPACE_OPTION_HELP = "Workspace (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')";

/**
 * A topic's lifecycle from the CLI: stop its running turn, archive it, or bring
 * it back — through the same entries the app's own buttons use
 * (`aiAgent.interruptTask`, `topic.updateTopic`).
 */
export function registerTopicLifecycleCommands(topic: Command) {
  topic
    .command('stop <topicId>')
    .description("Stop the topic's running turn (the ones you started)")
    .option(
      '--force',
      'End the run even if its device cannot confirm the process stopped (it can no longer write to the topic)',
    )
    .option('--workspace <id|slug>', WORKSPACE_OPTION_HELP)
    .option('--json', 'Output JSON')
    .action((topicId: string, options: { force?: boolean; json?: boolean; workspace?: string }) =>
      run(async () => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        const result = (await client.aiAgent.interruptTask.mutate({
          ...(options.force ? { force: true } : {}),
          topicId,
        })) as {
          completionReason?: string;
          failureReason?: 'runner_unconfirmed' | 'runner_unreachable';
          running?: number;
          stopped?: number;
          success: boolean;
        };
        if (options.json) return outputJson(result);
        if (!result.success) {
          const pending = (result.running ?? 0) - (result.stopped ?? 0);
          const why =
            result.failureReason === 'runner_unreachable'
              ? 'its device is offline or no longer holds the process, but the run reported recently'
              : 'a device may still be running them';
          throw new Error(
            `${topicId}: ${pending} run(s) could not be confirmed stopped (${why}). Try again once the device is reachable, or pass --force to end the run anyway.`,
          );
        }
        if (result.completionReason) {
          console.log(
            `${pc.green('✓')} Ended ${topicId}: its runner was gone (${result.completionReason}).`,
          );
          return;
        }
        console.log(
          result.stopped ? `${pc.green('✓')} Stopped ${topicId}.` : `${topicId} was not running.`,
        );
      }),
    );

  topic
    .command('archive <topicId>')
    .description(
      'Archive a topic: it leaves the agent list, and its auto-created worktree is cleaned up',
    )
    .option('--workspace <id|slug>', WORKSPACE_OPTION_HELP)
    .action((topicId: string, options: { workspace?: string }) =>
      run(async () => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        await client.topic.updateTopic.mutate({
          id: topicId,
          value: { completedAt: new Date(), status: 'completed' },
        });
        console.log(`${pc.green('✓')} Archived ${topicId}.`);
      }),
    );

  topic
    .command('unarchive <topicId>')
    .description('Bring an archived topic back to the agent list')
    .option('--workspace <id|slug>', WORKSPACE_OPTION_HELP)
    .action((topicId: string, options: { workspace?: string }) =>
      run(async () => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        await client.topic.updateTopic.mutate({
          id: topicId,
          value: { completedAt: null, status: 'active' },
        });
        console.log(`${pc.green('✓')} Unarchived ${topicId}.`);
      }),
    );
}
