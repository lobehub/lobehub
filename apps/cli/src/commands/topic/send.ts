import { randomUUID } from 'node:crypto';

import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceRef } from '../../api/workspaceRef';
import { resolveLocalDeviceId } from '../../utils/device';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';

/** Rounds of queue-or-start before giving up on a topic that keeps getting busy. */
const MAX_DELIVERY_ATTEMPTS = 3;

export interface ConversationSendResult {
  agentId: string;
  /**
   * Opened a new conversation and started its agent (`created`), started a run
   * of an existing conversation's agent (`started`), or queued behind its
   * running turn (`queued`).
   */
  delivery: 'created' | 'queued' | 'started';
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

  // Queue behind a running turn, start a turn when idle — never interrupt. The
  // start refuses (CONFLICT) if a turn began after the queue saw the topic idle;
  // then the message goes back to the queue. One entry id across attempts, so a
  // retried append is stored at most once.
  const entryId = randomUUID();
  let started: { error?: string; operationId?: string; success?: boolean } | undefined;
  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS && !started; attempt += 1) {
    const queued = await client.agentSteerQueue.append.mutate({ id: entryId, request } as any);
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

    try {
      started = (await client.aiAgent.execAgent.mutate({
        ...request,
        supersedeLiveRun: false,
      } as any)) as typeof started;
    } catch (error) {
      if ((error as { data?: { code?: string } })?.data?.code !== 'CONFLICT') throw error;
    }
  }
  if (!started) {
    throw new Error(`Topic ${topicId} kept starting new turns; try again in a moment.`);
  }
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

/**
 * The device a new conversation runs on: an id from `lh device list`, or
 * `local` for the device this CLI is connected as. It has to be online — a run
 * is never moved to another machine behind the caller's back.
 *
 * @throws with a message fit for the user when the device cannot be used
 */
const resolveTargetDevice = async (client: TrpcClient, device: string): Promise<string> => {
  const deviceId = device === 'local' ? resolveLocalDeviceId() : device;
  if (!deviceId) {
    throw new Error(
      "No local device found. Run 'lh connect' first, then retry with --device local.",
    );
  }

  const devices = (await client.device.listDevices.query()) as {
    deviceId?: string;
    online?: boolean;
  }[];
  const matched = devices.find((candidate) => candidate.deviceId === deviceId);
  if (!matched) {
    throw new Error(`Device "${deviceId}" was not found. Check 'lh device list' and try again.`);
  }
  if (!matched.online) {
    throw new Error(
      device === 'local'
        ? `Local device "${deviceId}" is not online. Reconnect with 'lh connect' and try again.`
        : `Device "${deviceId}" is not online. Bring it online and try again.`,
    );
  }
  return deviceId;
};

/**
 * Dispatch a message into a NEW conversation of an agent — the calling agent
 * itself by default — and start that agent on it: handing work to a fresh
 * conversation the way `sendToConversation` hands it to an existing one, with
 * the same authorship, reply route and relay bound. With a device the
 * conversation is bound to it, so its later turns run there too.
 *
 * @throws with a message fit for the user when the send is refused
 */
export const sendToNewConversation = async (
  client: TrpcClient,
  params: {
    agentId?: string;
    content: string;
    device?: string;
    title?: string;
  },
): Promise<ConversationSendResult> => {
  const agentId = params.agentId ?? process.env.LOBEHUB_AGENT_ID;
  if (!agentId) {
    throw new Error(
      'No agent to start the new conversation with: pass --agent-id (LOBEHUB_AGENT_ID is not set).',
    );
  }

  const request: Record<string, any> = {
    agentId,
    prompt: params.content,
    trigger: 'cli',
    // Nobody is at the new conversation's composer to approve tool calls.
    userInterventionConfig: { approvalMode: 'headless' },
  };
  if (params.device) {
    request.deviceId = await resolveTargetDevice(client, params.device);
    // The server refuses (nothing written) when the agent's effective execution
    // target would drop the device, instead of running the work elsewhere.
    request.requireDevice = true;
  }
  if (params.title) request.title = params.title;
  const sourceOperationId = process.env.LOBEHUB_OPERATION_ID;
  if (sourceOperationId) request.sourceOperationId = sourceOperationId;

  const started = (await client.aiAgent.execAgent.mutate(request as any)) as {
    error?: string;
    operationId?: string;
    success?: boolean;
    topicId?: string;
  };
  if (!started.success || !started.topicId) {
    throw new Error(
      `Failed to start a new conversation of ${agentId}: ${started.error || 'unknown error'}`,
    );
  }

  return {
    agentId,
    delivery: 'created',
    operationId: started.operationId,
    topicId: started.topicId,
  };
};

/** Options shared by the commands that send into a new conversation. */
export interface NewConversationOptions {
  agentId?: string;
  device?: string;
  title?: string;
}

export const NEW_CONVERSATION_OPTIONS_HELP = {
  agentId:
    'Agent of the new conversation (default: the agent running this command, LOBEHUB_AGENT_ID)',
  device:
    'Device the new conversation runs on — an id from `lh device list`, or "local" for this machine; later turns stay on it',
  title: 'Title of the new conversation (default: taken from the message)',
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
    result.delivery === 'created'
      ? `${pc.green('✓')} Opened ${pc.bold(result.topicId)}; its agent is working on it (operation ${pc.dim(result.operationId ?? 'n/a')}).`
      : result.delivery === 'started'
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
    .command('send [topicId]')
    .description(
      "Send a message to another conversation and have its agent act on it (queued if it is busy), or with --new hand it to a new conversation. Unlike 'lh message create', this wakes the agent",
    )
    .requiredOption('-c, --content <content>', 'Message content')
    .option('--new', 'Open a new conversation for the message instead of sending to <topicId>')
    .option('--agent-id <id>', `With --new: ${NEW_CONVERSATION_OPTIONS_HELP.agentId}`)
    .option('--device <target>', `With --new: ${NEW_CONVERSATION_OPTIONS_HELP.device}`)
    .option('--title <title>', `With --new: ${NEW_CONVERSATION_OPTIONS_HELP.title}`)
    .option(
      '--workspace <id|slug>',
      "The workspace the topic lives in (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .option('--json', 'Output JSON')
    .addHelpText(
      'after',
      `
Examples:
  lh topic send tpc_xxx -c "Iterate the verifier with these notes"
  lh topic send --new -c "Draft the release notes" --device local --title "Release notes"

Run by an agent, the message is shown as written by that agent, and the
receiving agent can answer it with 'lh message reply <messageId>', which wakes
the sending conversation. Agents that keep sending to each other are stopped
after a few rounds, so a person can step in.`,
    )
    .action(
      async (
        topicId: string | undefined,
        options: NewConversationOptions & {
          content: string;
          json?: boolean;
          new?: boolean;
          workspace?: string;
        },
      ) => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        await reportConversationSend(() => {
          if (options.new) {
            if (topicId) throw new Error('Pass either <topicId> or --new, not both.');
            return sendToNewConversation(client, { ...options });
          }
          if (!topicId) {
            throw new Error('Pass the <topicId> to send to, or --new to open a new conversation.');
          }
          if (options.agentId || options.device || options.title) {
            throw new Error(
              '--agent-id, --device and --title only apply with --new; an existing conversation keeps its own.',
            );
          }
          return sendToConversation(client, { content: options.content, topicId });
        }, options);
      },
    );
}
