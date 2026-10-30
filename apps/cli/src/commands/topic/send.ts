import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceRef } from '../../api/workspaceRef';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';

export interface ConversationSendResult {
  agentId: string;
  /** Started a run of the conversation's agent (`started`), or queued behind its running turn. */
  delivery: 'queued' | 'started';
  operationId?: string;
  threadId?: string;
  topicId: string;
}

/**
 * Deliver a message into another conversation and have its own agent act on
 * it, the way typing into that conversation's composer would: start a turn when
 * it is idle, or queue behind the running turn instead of interrupting it.
 *
 * When an agent runs this, its `LOBEHUB_OPERATION_ID` goes along, so the
 * server records that agent as the author (`metadata.agentSender`) — which is
 * what lets the receiving agent see who wrote and `lh message reply` to it.
 *
 * @throws with a message fit for the user when the send is refused
 */
export const sendToConversation = async (
  client: TrpcClient,
  params: { content: string; threadId?: string; topicId: string },
): Promise<ConversationSendResult> => {
  const { content, threadId, topicId } = params;

  if (!threadId && topicId === process.env.LOBEHUB_TOPIC_ID) {
    throw new Error(
      `${topicId} is the conversation you are running in; answer here instead of sending to it.`,
    );
  }

  const topic = (await client.topic.getTopicDetail.query({ id: topicId })) as {
    agentId?: null | string;
    groupId?: null | string;
  } | null;
  if (!topic) throw new Error(`Topic ${topicId} not found in this workspace.`);
  if (topic.groupId) {
    throw new Error(
      `Topic ${topicId} is a group conversation; sending into groups is not supported yet.`,
    );
  }
  if (!topic.agentId)
    throw new Error(`Topic ${topicId} belongs to no agent, so nothing could act on it.`);

  const request: Record<string, any> = {
    agentId: topic.agentId,
    appContext: threadId ? { threadId, topicId } : { topicId },
    prompt: content,
    trigger: 'cli',
    // Nobody is at that conversation's composer to approve tool calls.
    userInterventionConfig: { approvalMode: 'headless' },
  };
  const sourceOperationId = process.env.LOBEHUB_OPERATION_ID;
  if (sourceOperationId) request.sourceOperationId = sourceOperationId;

  // A busy conversation takes the message behind its running turn: starting a
  // run directly would interrupt the one in progress.
  const queued = await client.agentSteerQueue.append.mutate({ request } as any);
  if (queued.queued) {
    return { agentId: topic.agentId, delivery: 'queued', threadId, topicId };
  }
  if (queued.reason !== 'idle') {
    throw new Error(
      queued.reason === 'full'
        ? `Topic ${topicId} already has too many messages waiting behind its running turn; try again after it finishes.`
        : `Could not queue the message behind the running turn of ${topicId}; try again.`,
    );
  }

  const started = (await client.aiAgent.execAgent.mutate(request as any)) as {
    error?: string;
    operationId?: string;
    success?: boolean;
  };
  if (!started.success) {
    throw new Error(`Failed to start the agent of ${topicId}: ${started.error || 'unknown error'}`);
  }

  return {
    agentId: topic.agentId,
    delivery: 'started',
    operationId: started.operationId,
    threadId,
    topicId,
  };
};

/** Print a send's outcome, or the reason it was refused, and set the exit code. */
export const reportConversationSend = async (
  send: () => Promise<ConversationSendResult>,
  options: { json?: boolean },
) => {
  let result: ConversationSendResult;
  try {
    result = await send();
  } catch (error) {
    log.error((error as Error).message);
    process.exit(1);
    return;
  }

  if (options.json) {
    outputJson(result);
    return;
  }

  console.log(
    result.delivery === 'started'
      ? `${pc.green('✓')} Sent to ${pc.bold(result.topicId)}; its agent is working on it (operation ${pc.dim(result.operationId ?? 'n/a')}).`
      : `${pc.green('✓')} Sent to ${pc.bold(result.topicId)}; it is busy, so its agent takes the message right after the current turn.`,
  );
  console.log(
    pc.dim(
      'The answer arrives in that conversation. If it replies to you, the reply wakes this one.',
    ),
  );
};

export function registerTopicSendCommand(topic: Command) {
  topic
    .command('send <topicId>')
    .description(
      "Send a message to another conversation and have its agent act on it (queued if it is busy). Unlike 'lh message create', this wakes the agent",
    )
    .requiredOption('-c, --content <content>', 'Message content')
    .option(
      '--workspace <id|slug>',
      "The workspace the topic lives in (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .option('--json', 'Output JSON')
    .addHelpText(
      'after',
      `
Run by an agent, the message is shown as written by that agent, and the
receiving agent can answer it with 'lh message reply <messageId>', which wakes
the sending conversation. Agents that keep sending to each other are stopped
after a few rounds, so a person can step in.`,
    )
    .action(
      async (topicId: string, options: { content: string; json?: boolean; workspace?: string }) => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        await reportConversationSend(
          () => sendToConversation(client, { content: options.content, topicId }),
          options,
        );
      },
    );
}
