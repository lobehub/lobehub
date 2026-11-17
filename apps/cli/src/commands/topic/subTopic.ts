import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceRef } from '../../api/workspaceRef';
import { outputJson, printTable, truncate } from '../../utils/format';
import { log } from '../../utils/logger';

/**
 * Sub-topics — conversations this one opened (`lh topic send --new` from inside
 * a conversation): listing them, and stopping or archiving one. Reading and
 * sending use `lh topic view` / `lh topic send`.
 */

const parentTopicOf = (parentTopicId?: string) => {
  const parent = parentTopicId ?? process.env.LOBEHUB_TOPIC_ID;
  if (!parent) {
    throw new Error('No parent topic: pass --parent-topic-id (LOBEHUB_TOPIC_ID is not set).');
  }
  return parent;
};

/** Print a refusal and exit 1 instead of a stack trace. */
const run = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (error) {
    log.error((error as Error).message);
    process.exit(1);
  }
};

/** `lh topic list --opened-by-me`. */
export const listSubTopics = (
  client: TrpcClient,
  options: { json?: string | boolean; parentTopicId?: string },
) =>
  run(async () => {
    const items = await client.subTopic.list.query({
      openerTopicId: parentTopicOf(options.parentTopicId),
    });
    if (options.json !== undefined) {
      outputJson(items, typeof options.json === 'string' ? options.json : undefined);
      return;
    }
    if (items.length === 0) {
      console.log('No sub-topics.');
      return;
    }
    printTable(
      items.map((item) => [
        item.topicId,
        item.state,
        truncate(item.title ?? 'Untitled', 50),
        item.agentId ?? '',
      ]),
      ['ID', 'STATE', 'TITLE', 'AGENT'],
    );
  });

export function registerTopicSubTopicCommands(topic: Command) {
  topic
    .command('stop <topicId>')
    .description(
      "Stop a topic's current turn (a sub-topic's stopped turn is not reported back to its parent)",
    )
    .option(
      '--workspace <id|slug>',
      "Workspace (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .option('--json', 'Output JSON')
    .action((topicId: string, options: { json?: boolean; workspace?: string }) =>
      run(async () => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        const result = await client.subTopic.stop.mutate({ topicId });
        if (options.json) return outputJson(result);
        console.log(
          result.stopped > 0
            ? `${pc.green('✓')} Stopped ${topicId}.`
            : `${topicId} was not running.`,
        );
      }),
    );

  topic
    .command('archive <topicId>')
    .description(
      'Archive a topic. Its sub-topics move to the top level, unless --all archives them too (stopping running ones)',
    )
    .option(
      '--all',
      'Also stop and archive every sub-topic under it (task runs are left to their task)',
    )
    .option(
      '--workspace <id|slug>',
      "Workspace (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .option('--json', 'Output JSON')
    .action((topicId: string, options: { all?: boolean; json?: boolean; workspace?: string }) =>
      run(async () => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        const result = await client.subTopic.archive.mutate({
          mode: options.all ? 'all' : 'self',
          topicId,
        });
        if (options.json) return outputJson(result);
        console.log(`${pc.green('✓')} Archived ${result.retired.length} topic(s).`);
      }),
    );
}
