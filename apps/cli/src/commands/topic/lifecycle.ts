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
    .option('--workspace <id|slug>', WORKSPACE_OPTION_HELP)
    .option('--json', 'Output JSON')
    .action((topicId: string, options: { json?: boolean; workspace?: string }) =>
      run(async () => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        const result = (await client.aiAgent.interruptTask.mutate({ topicId })) as {
          running?: number;
          stopped?: number;
          success: boolean;
        };
        if (options.json) return outputJson(result);
        if (!result.success) {
          throw new Error(
            `${topicId}: ${(result.running ?? 0) - (result.stopped ?? 0)} run(s) could not be confirmed stopped (a device may still be running them). Try again once the device is reachable.`,
          );
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
