import type { ChannelMessageMetadata, InboundWebhookChannelDelivery } from '@lobechat/types';
import { BOT_NO_REPLY_TOKEN } from '@lobechat/types';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { MessageModel } from '@/database/models/message';
import { ChannelError, ChannelRepository } from '@/database/repositories/channel';
import { channelJobs, channelMembers, channelThreads } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { extractTextFromMessage } from '@/server/services/agentRuntime/CompletionLifecycle/messageContent';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { notifyChannel } from '@/server/services/channel/notify';
import { runSurfaces } from '@/server/services/channel/runSurfaces';
import { detectNoReply } from '@/server/services/conversationWake/noReply';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

const log = debug('lobe-server:inbound-webhook:channel-delivery');

export const INBOUND_WEBHOOK_REPORT_WEBHOOK = '/api/agent/webhooks/inbound-webhook-report';

/**
 * Told to a run whose answer is posted to a Channel from outside it (an inbound webhook, a scheduled
 * task), so it writes for the people there and knows it may answer with a card.
 */
export const CHANNEL_DELIVERY_INSTRUCTION = `Your final answer is posted as your message in the Channel (or Thread) this run delivers to, so write it for the people there. You may answer with a card (lobe-a2ui renderUI): the cards you draw are posted with your answer, even with no words after them. If nothing here is worth telling them, answer exactly ${BOT_NO_REPLY_TOKEN} and nothing will be posted.`;

/**
 * Nobody can approve a tool call in a run whose answer goes to a Channel: the run's Topic is not
 * where the people are. Like every Channel run, it never waits; tools marked `always` are skipped.
 */
export const CHANNEL_DELIVERY_INTERVENTION = { approvalMode: 'headless' } as const;

export class ChannelDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelDeliveryError';
  }
}

interface Scope {
  userId: string;
  workspaceId?: string;
}

/**
 * Check a delivery target as the webhook's creator: they must be an active member of the Channel
 * in this scope, the Agent an active, unmuted member, and the Thread one of that Channel. The same
 * checks run again on every post; this one turns a wrong id into an error at configuration time.
 */
export async function assertChannelDelivery(
  db: LobeChatDatabase,
  scope: Scope,
  agentId: string,
  delivery: InboundWebhookChannelDelivery,
): Promise<InboundWebhookChannelDelivery> {
  const access = await new ChannelRepository(db, scope.userId, scope.workspaceId).findAccess(
    delivery.channelId,
  );
  if (!access || access.channel.isDeleted)
    throw new ChannelDeliveryError('Channel not found, or you are not a member of it.');
  if (access.channel.status === 'archived')
    throw new ChannelDeliveryError('This Channel is archived.');
  const [member] = await db
    .select({ config: channelMembers.config })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, delivery.channelId),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.agentId, agentId),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!member) throw new ChannelDeliveryError('This Agent is not a member of that Channel.');
  if (member.config?.muted) throw new ChannelDeliveryError('This Agent is muted in that Channel.');
  if (delivery.threadId) {
    const [thread] = await db
      .select({ id: channelThreads.id })
      .from(channelThreads)
      .where(
        and(
          eq(channelThreads.channelId, delivery.channelId),
          eq(channelThreads.id, delivery.threadId),
          notTrashed(channelThreads.isDeleted),
        ),
      )
      .limit(1);
    if (!thread) throw new ChannelDeliveryError('Thread not found in that Channel.');
  }
  return {
    channelId: delivery.channelId,
    ...(delivery.threadId && { threadId: delivery.threadId }),
  };
}

/**
 * Where a Channel run is answering: its Channel and the branch (main timeline or Thread) of the
 * job it runs for. Undefined for a run that is not a Channel job.
 */
export async function channelOriginOfRun(
  db: LobeChatDatabase,
  operationId: string,
): Promise<{ channelId: string; threadId: string | null } | undefined> {
  const [job] = await db
    .select({ channelId: channelJobs.channelId, threadId: channelJobs.threadId })
    .from(channelJobs)
    .where(eq(channelJobs.operationId, operationId))
    .limit(1);
  return job;
}

export type RunChannelPostResult = 'not-done' | 'posted' | 'silent' | 'unavailable';

/**
 * Post what a finished run concluded to a Channel (or Thread) as the Agent's message: its final
 * text and the cards it drew, stored like a published reply. The run stays in its Topic; only its
 * answer reaches the Channel. A card-only answer posts; NO_REPLY with no card posts nothing. A post
 * the Channel refuses (requester or Agent no longer a member, Agent muted, Channel archived) is
 * `unavailable`.
 *
 * Shared by every run whose answer is delivered to a Channel from outside it (an inbound webhook,
 * a scheduled task). Idempotent per `requestKey`: a repeated completion finds the post there.
 */
export async function postRunAnswerToChannel(
  db: LobeChatDatabase,
  params: {
    /** The Agent that posts; defaults to the run's own Agent. */
    agentId?: string;
    delivery: InboundWebhookChannelDelivery;
    metadata: ChannelMessageMetadata;
    operationId: string;
    requestKey: string;
    scope: Scope;
  },
): Promise<{ error?: ChannelError; result: RunChannelPostResult; topicId?: string }> {
  const { scope } = params;
  const operation = await new AgentOperationModel(db, scope.userId, scope.workspaceId).findById(
    params.operationId,
  );
  if (operation?.status !== 'done' || !operation.topicId) return { result: 'not-done' };
  const topicId = operation.topicId;
  const agentId = params.agentId ?? operation.agentId;
  if (!agentId) return { result: 'unavailable', topicId };

  const messages = new MessageModel(db, scope.userId, scope.workspaceId);
  const [final, surfaces] = await Promise.all([
    messages.findLatestAssistantByOperationId({ operationId: params.operationId, topicId }),
    runSurfaces(messages, params.operationId, topicId),
  ]);
  // A run that stopped on a tool call (out of steps) has nothing to tell yet, unless it drew a
  // card: a card is posted even with no words after it, like a Channel reply's.
  const content = final?.tools?.length ? undefined : extractTextFromMessage(final);
  const silent = !content?.trim() || detectNoReply({ content, wakeKind: 'followup' });
  if (silent && !surfaces.length) return { result: 'silent', topicId };

  try {
    await new ChannelRepository(db, scope.userId, scope.workspaceId).postAgentMessage(
      params.delivery.channelId,
      {
        agentId,
        content: silent ? '' : content!,
        metadata: { ...params.metadata, operationId: params.operationId, topicId },
        requestKey: params.requestKey,
        ...(surfaces.length > 0 && { surfaces }),
        threadId: params.delivery.threadId ?? null,
      },
    );
  } catch (error) {
    if (!(error instanceof ChannelError)) throw error;
    return { error, result: 'unavailable', topicId };
  }
  await notifyChannel(db, params.delivery.channelId);
  return { result: 'posted', topicId };
}

export type WebhookChannelReportResult = 'gone' | RunChannelPostResult;

/**
 * Post what a webhook-woken run concluded to the Channel (or Thread) the webhook delivers to, as
 * the Agent's message (see {@link postRunAnswerToChannel}). A post the Channel refuses is recorded
 * on the webhook as `channel_unavailable`.
 *
 * Idempotent per run: a repeated completion callback finds the post already there.
 */
export async function reportWebhookRunToChannel(
  db: LobeChatDatabase,
  params: { operationId: string; webhookId: string },
): Promise<WebhookChannelReportResult> {
  const found = await InboundWebhookModel.findForDelivery(db, params.webhookId, () =>
    KeyVaultsGateKeeper.initWithEnvKey(),
  );
  const delivery = found?.row.config.delivery;
  if (!found || !delivery) return 'gone';
  const { row } = found;
  const workspaceId = row.workspaceId ?? undefined;

  const { error, result } = await postRunAnswerToChannel(db, {
    agentId: row.agentId,
    delivery,
    metadata: { source: 'inbound-webhook', webhookId: row.id },
    operationId: params.operationId,
    requestKey: `inbound-webhook:${params.operationId}`,
    scope: { userId: row.userId, workspaceId },
  });
  if (result === 'unavailable') {
    log('webhook %s cannot post to channel %s: %s', row.id, delivery.channelId, error?.message);
    await new InboundWebhookModel(db, row.userId, workspaceId).update(row.id, {
      lastError: 'channel_unavailable',
    });
  } else if (result === 'posted' && row.lastError === 'channel_unavailable')
    await new InboundWebhookModel(db, row.userId, workspaceId).update(row.id, { lastError: null });
  return result;
}

/**
 * The completion hook a run with a Channel delivery carries: on the queue runtime a QStash webhook
 * (the process that started the run may be gone), otherwise an in-process handler.
 */
export const createWebhookChannelReportHook = (
  db: LobeChatDatabase,
  webhookId: string,
): AgentHook => ({
  id: `inbound-webhook-report:${webhookId}`,
  type: 'onComplete',
  ...(isQueueAgentRuntimeEnabled()
    ? {
        webhook: {
          body: { webhookId },
          delivery: 'qstash' as const,
          // Identity only: the answer is read back from storage, never carried in the envelope.
          eventFields: ['operationId'],
          fallback: 'none' as const,
          url: INBOUND_WEBHOOK_REPORT_WEBHOOK,
        },
      }
    : {
        handler: async (event) => {
          await reportWebhookRunToChannel(db, {
            operationId: event.operationId,
            webhookId,
          }).catch((error) => console.error('[inboundWebhook] posting the run failed:', error));
        },
      }),
});
