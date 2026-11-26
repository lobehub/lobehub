import { A2uiIdentifier } from '@lobechat/builtin-tool-a2ui';
import type { TaskChannelDelivery, TaskChannelDeliveryInput } from '@lobechat/types';
import { readTaskChannelDelivery } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import type { RunChannelPostResult } from '@/server/services/inboundWebhook/channelDelivery';
import {
  assertChannelDelivery,
  CHANNEL_DELIVERY_INSTRUCTION,
  ChannelDeliveryError,
  channelOriginOfRun,
  postRunAnswerToChannel,
} from '@/server/services/inboundWebhook/channelDelivery';

const log = debug('lobe-server:task:channel-delivery');

interface Scope {
  userId: string;
  workspaceId?: string;
}

/**
 * Checks a write that sets `config.delivery` (task create, `updateConfig`) as the writer: they must
 * be a member of the Channel, the task's Agent an active, unmuted member, the Thread one of that
 * Channel. Returns the config with the delivery normalized for storage; `delivery: null` clears it.
 * The same checks run again on every post, so a Channel that later refuses only skips that post.
 */
export const normalizeTaskDeliveryConfig = async <T extends Record<string, unknown> | undefined>(
  db: LobeChatDatabase,
  scope: Scope,
  agentId: string | null | undefined,
  config: T,
): Promise<T> => {
  if (!config || !('delivery' in config) || config.delivery === null) return config;
  const delivery = readTaskChannelDelivery(config);
  if (!delivery) throw new ChannelDeliveryError('A Channel delivery needs a channelId.');
  if (!agentId)
    throw new ChannelDeliveryError(
      'Assign the task to an Agent before posting its results to a Channel.',
    );
  const checked = await assertChannelDelivery(db, scope, agentId, delivery);
  return {
    ...config,
    // An explicit null, so a write without a Thread replaces an earlier one under the deep merge.
    delivery: { channelId: checked.channelId, threadId: checked.threadId ?? null },
  };
};

/** {@link normalizeTaskDeliveryConfig} for an API write: a refused delivery is a bad request. */
export const checkTaskDeliveryConfig: typeof normalizeTaskDeliveryConfig = async (...args) => {
  try {
    return await normalizeTaskDeliveryConfig(...args);
  } catch (error) {
    if (error instanceof ChannelDeliveryError)
      throw new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message });
    throw error;
  }
};

/**
 * Where an Agent asks a task's results to go: `null` stops posting; an explicit `channelId` is that
 * Channel (its main timeline unless `threadId` names a Thread); `{}` is where the asking run is
 * answering now, its Thread included.
 */
export const resolveTaskDeliveryInput = async (
  db: LobeChatDatabase,
  operationId: string | undefined,
  input: TaskChannelDeliveryInput | null,
): Promise<TaskChannelDelivery | null> => {
  if (input === null) return null;
  const channelId = input.channelId?.trim();
  const threadId = input.threadId?.trim() || undefined;
  if (channelId) return { channelId, threadId: threadId ?? null };
  const origin = operationId ? await channelOriginOfRun(db, operationId) : undefined;
  if (!origin)
    throw new ChannelDeliveryError(
      'This conversation is not in a Channel: give the channelId to post to (find it with lobe-channel listChannels).',
    );
  return { channelId: origin.channelId, threadId: threadId ?? origin.threadId ?? null };
};

/** One line for the tool result saying where results now go. */
export const describeTaskDelivery = (delivery: TaskChannelDelivery | null) =>
  delivery
    ? `results post to Channel ${delivery.channelId}${
        delivery.threadId ? ` (Thread ${delivery.threadId})` : ' (main timeline)'
      }`
    : 'Channel delivery cleared';

/**
 * What a run of a task with a Channel delivery adds: it is told its answer goes to the Channel,
 * and gets the card tool, since the cards it draws are posted with that answer.
 */
export const taskChannelDeliveryRun = (config: unknown) =>
  readTaskChannelDelivery(config)
    ? { additionalPluginIds: [A2uiIdentifier], instructions: CHANNEL_DELIVERY_INSTRUCTION }
    : undefined;

/**
 * Post a finished task run's answer (text and cards) to the task's Channel delivery as the run's
 * Agent. Idempotent per run: a repeated completion callback finds the post already there.
 * `none` when the task delivers nowhere.
 */
export const postTaskRunToChannel = async (
  db: LobeChatDatabase,
  params: {
    operationId: string;
    scope: Scope;
    task: { config: unknown; id: string; identifier: string };
  },
): Promise<RunChannelPostResult | 'none'> => {
  const delivery = readTaskChannelDelivery(params.task.config);
  if (!delivery) return 'none';
  const { error, result } = await postRunAnswerToChannel(db, {
    delivery,
    metadata: { source: 'task', taskId: params.task.id, taskIdentifier: params.task.identifier },
    operationId: params.operationId,
    requestKey: `task-delivery:${params.operationId}`,
    scope: params.scope,
  });
  if (result === 'unavailable')
    log(
      'task %s cannot post to channel %s: %s',
      params.task.identifier,
      delivery.channelId,
      error?.message,
    );
  return result;
};

/**
 * Queues the write `lobe-task.setTaskSchedule` makes for its `channelDelivery`: resolved (`{}` is
 * where the asking run answers), checked against the task's Agent, then merged into
 * `config.delivery` through `updateConfig`. Returns why it was refused, if it was; nothing is
 * queued then.
 */
export const queueTaskDelivery = async (
  deps: {
    db?: LobeChatDatabase;
    operationId?: string;
    taskCaller: {
      updateConfig: (input: { config: Record<string, unknown>; id: string }) => Promise<unknown>;
    };
    userId?: string;
    workspaceId?: string;
  },
  task: { assigneeAgentId: string | null; id: string },
  input: TaskChannelDeliveryInput | null | undefined,
  ops: Promise<unknown>[],
  changes: string[],
): Promise<string | undefined> => {
  if (input === undefined) return;
  if (!deps.db || !deps.userId) return 'Channel delivery is not available here.';
  try {
    const delivery = await resolveTaskDeliveryInput(deps.db, deps.operationId, input);
    const config = await normalizeTaskDeliveryConfig(
      deps.db,
      { userId: deps.userId, workspaceId: deps.workspaceId },
      task.assigneeAgentId,
      { delivery },
    );
    ops.push(deps.taskCaller.updateConfig({ config, id: task.id }));
    changes.push(describeTaskDelivery(delivery));
  } catch (error) {
    if (error instanceof ChannelDeliveryError) return error.message;
    throw error;
  }
};
