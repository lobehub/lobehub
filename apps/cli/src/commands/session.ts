import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../api/client';
import { getTrpcClient } from '../api/client';
import { resolveWorkspaceRef } from '../api/workspaceRef';
import { outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { resolveTargetDevice } from './topic/send';

/**
 * `lh session …`: sub-sessions — conversations this one opens, listed under it
 * in LobeHub's sidebar and reporting back to it when each of their turns ends.
 * The same operations the `lobe-session` tool gives native agents.
 */

const WORKSPACE_MODES = ['inherit', 'new-worktree', 'none'] as const;

interface CommonOptions {
  json?: boolean;
  workspace?: string;
}

const clientFor = async (options: CommonOptions) =>
  getTrpcClient(await resolveWorkspaceRef(options.workspace));

/** Run one call; print the refusal and exit 1 instead of a stack trace. */
const run = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (error) {
    log.error((error as Error).message);
    process.exit(1);
  }
};

const openerOf = (topicId?: string) => {
  const opener = topicId ?? process.env.LOBEHUB_TOPIC_ID;
  if (!opener) {
    throw new Error(
      'No conversation to open it from: pass --topic-id (LOBEHUB_TOPIC_ID is not set).',
    );
  }
  return opener;
};

export interface SessionStartOptions extends CommonOptions {
  agentId?: string;
  baseBranch?: string;
  content: string;
  device?: string;
  title?: string;
  topicId?: string;
  where?: (typeof WORKSPACE_MODES)[number];
}

export const startSession = async (client: TrpcClient, options: SessionStartOptions) => {
  if (options.where && !WORKSPACE_MODES.includes(options.where)) {
    throw new Error(`--where must be one of: ${WORKSPACE_MODES.join(', ')}.`);
  }
  const sourceOperationId = process.env.LOBEHUB_OPERATION_ID;
  return client.subSession.start.mutate({
    ...(options.agentId && { agentId: options.agentId }),
    ...(options.baseBranch && { baseBranch: options.baseBranch }),
    ...(options.device && { deviceId: await resolveTargetDevice(client, options.device) }),
    openerTopicId: openerOf(options.topicId),
    prompt: options.content,
    ...(sourceOperationId && { sourceOperationId }),
    ...(options.title && { title: options.title }),
    ...(options.where && { workspace: options.where }),
  });
};

export function registerSessionCommand(program: Command) {
  const session = program
    .command('session')
    .description(
      'Sub-sessions: conversations this one opens. They run on their own, show under this conversation in LobeHub, and report back here when each of their turns ends',
    );

  session
    .command('start')
    .description('Open a sub-session and send its first message; returns at once')
    .requiredOption('-c, --content <content>', 'First message: a self-contained brief')
    .option('--agent-id <id>', 'Agent to run it (default: this agent)')
    .option('--title <title>', 'Title (default: taken from the message)')
    .option(
      '--where <mode>',
      'Working directory: inherit (default, this conversation’s directory), new-worktree (a fresh git worktree and branch), none (the agent default)',
    )
    .option('--base-branch <branch>', 'With --where new-worktree: the branch to fork from')
    .option('--device <target>', 'Device to run on — an id from `lh device list`, or "local"')
    .option('--topic-id <tpc_id>', 'Conversation that opens it (default: LOBEHUB_TOPIC_ID)')
    .option(
      '--workspace <id|slug>',
      "Workspace (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .option('--json', 'Output JSON')
    .addHelpText(
      'after',
      `
Examples:
  lh session start -c "Fix the flaky upload test; done when CI is green" --where new-worktree
  lh session start -c "Review the API change in this branch" --agent-id agt_codex

Do not poll it: when a turn of the sub-session ends, its reply arrives in this
conversation as a <sub_session_result> message.`,
    )
    .action((options: SessionStartOptions) =>
      run(async () => {
        const client = await clientFor(options);
        const started = await startSession(client, options);
        if (options.json) return outputJson(started);
        console.log(
          `${pc.green('✓')} Opened sub-session ${pc.bold(started.topicId)}${started.branch ? ` on branch ${pc.cyan(started.branch)}` : ''}; its agent is working on it.`,
        );
        console.log(pc.dim('Its reply is reported back to this conversation when its turn ends.'));
      }),
    );

  session
    .command('list')
    .description('List the sub-sessions a conversation opened')
    .option('--topic-id <tpc_id>', 'The opener (default: LOBEHUB_TOPIC_ID)')
    .option('--workspace <id|slug>', 'Workspace')
    .option('--json', 'Output JSON')
    .action((options: CommonOptions & { topicId?: string }) =>
      run(async () => {
        const client = await clientFor(options);
        const items = await client.subSession.list.query({
          openerTopicId: openerOf(options.topicId),
        });
        if (options.json) return outputJson(items);
        if (items.length === 0) return void console.log('No sub-sessions.');
        printTable(
          items.map((item) => [
            item.topicId,
            item.state,
            truncate(item.title ?? '', 50),
            item.agentId ?? '',
          ]),
          ['TOPIC', 'STATE', 'TITLE', 'AGENT'],
        );
      }),
    );

  session
    .command('get <topicId>')
    .description("A sub-session's state and its last reply")
    .option('--workspace <id|slug>', 'Workspace')
    .option('--json', 'Output JSON')
    .action((topicId: string, options: CommonOptions) =>
      run(async () => {
        const client = await clientFor(options);
        const item = await client.subSession.get.query({ topicId });
        if (options.json) return outputJson(item);
        console.log(`${pc.bold(topicId)} ${item.title ?? ''} — ${item.state}`);
        if (item.lastReply) console.log(`\n${item.lastReply}`);
      }),
    );

  session
    .command('read <topicId>')
    .description("Read a sub-session's latest messages")
    .option('-L, --limit <n>', 'How many of the latest messages', '30')
    .option('--workspace <id|slug>', 'Workspace')
    .option('--json', 'Output JSON')
    .action((topicId: string, options: CommonOptions & { limit?: string }) =>
      run(async () => {
        const client = await clientFor(options);
        const limit = Number.parseInt(options.limit ?? '30', 10) || 30;
        const result = await client.subSession.read.query({ limit, topicId });
        if (options.json) return outputJson(result.items);
        for (const item of result.items as { content?: null | string; role: string }[]) {
          if (!item.content?.trim()) continue;
          console.log(`${pc.dim(`[${item.role}]`)} ${item.content.trim()}\n`);
        }
      }),
    );

  session
    .command('send <topicId>')
    .description(
      "Send a message to a sub-session: starts a turn when idle, otherwise follows the user's follow-up setting (queue or steer)",
    )
    .requiredOption('-c, --content <content>', 'Message')
    .option('--workspace <id|slug>', 'Workspace')
    .option('--json', 'Output JSON')
    .action((topicId: string, options: CommonOptions & { content: string }) =>
      run(async () => {
        const client = await clientFor(options);
        const sourceOperationId = process.env.LOBEHUB_OPERATION_ID;
        const result = await client.subSession.send.mutate({
          message: options.content,
          ...(sourceOperationId && { sourceOperationId }),
          topicId,
        });
        if (options.json) return outputJson(result);
        console.log(
          result.delivery === 'queued'
            ? `${pc.green('✓')} ${pc.bold(topicId)} is busy; the message waits behind its current turn.`
            : `${pc.green('✓')} Sent to ${pc.bold(topicId)}; it started a new turn.`,
        );
      }),
    );

  session
    .command('stop <topicId>')
    .description("Stop a sub-session's current turn (a stopped turn is not reported back)")
    .option('--workspace <id|slug>', 'Workspace')
    .option('--json', 'Output JSON')
    .action((topicId: string, options: CommonOptions) =>
      run(async () => {
        const client = await clientFor(options);
        const result = await client.subSession.stop.mutate({ topicId });
        if (options.json) return outputJson(result);
        console.log(
          result.stopped > 0
            ? `${pc.green('✓')} Stopped ${topicId}.`
            : `${topicId} was not running.`,
        );
      }),
    );

  session
    .command('archive <topicId>')
    .description(
      'Archive a sub-session. Its own sub-sessions move to the top level unless --all archives them too',
    )
    .option('--all', 'Also stop and archive every sub-session under it')
    .option('--workspace <id|slug>', 'Workspace')
    .option('--json', 'Output JSON')
    .action((topicId: string, options: CommonOptions & { all?: boolean }) =>
      run(async () => {
        const client = await clientFor(options);
        const result = await client.subSession.archive.mutate({
          mode: options.all ? 'all' : 'self',
          topicId,
        });
        if (options.json) return outputJson(result);
        console.log(`${pc.green('✓')} Archived ${result.retired.length} conversation(s).`);
      }),
    );
}
