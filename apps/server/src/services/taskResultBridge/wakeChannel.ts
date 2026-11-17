import type { ChatTopicBotContext, ExecAgentResult, UserInterventionConfig } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import type { BotCallbackBody } from '@/server/services/bot/BotCallbackService';
import { BotCallbackService } from '@/server/services/bot/BotCallbackService';

import { resolveForegroundInterventionConfig } from '../aiAgent/foregroundIntervention';
import { acquireTopicStartReservation } from '../aiAgent/topicStartReservation';
import type { InternalExecAgentParams } from '../aiAgent/types';
import { TaskResultCallbackRedisStore } from './redisStore';

export interface CompleteCreatorWakeupParams {
  agentId: string;
  originTopicId: string;
  receiptIds: string[];
}

export type WakeChannelExecAgent = (params: InternalExecAgentParams) => Promise<ExecAgentResult>;

/**
 * Wakes a conversation for results that landed on its main line. Built with
 * the `execAgent` that starts the run, so the agent service can use it without
 * this module importing that service back. See {@link ResultWakeChannel.queueWakeup}.
 */
export class ResultWakeChannel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string | undefined,
    private readonly execAgent: WakeChannelExecAgent,
  ) {}

  /**
   * The one wake-up channel every "a result arrived for this conversation"
   * path shares — finished tasks, sub-topic turns and background
   * sub-agents. The caller has already written its result onto the
   * conversation's main line (`callbackMessageId`); this queues a receipt and
   * starts a single run that reads every result that landed, so results that
   * arrive together wake the agent once.
   *
   * Without Redis there is no queue to batch on: the conversation is woken
   * directly, the way background sub-agents always were.
   */
  async queueWakeup(params: {
    agentId: string;
    callbackMessageId: string;
    originTopicId: string;
    /** Unique per result; a repeated id is ignored, so retries are safe. */
    receiptId: string;
  }): Promise<void> {
    const { agentId, callbackMessageId, originTopicId, receiptId } = params;
    if (!TaskResultCallbackRedisStore.isAvailable()) {
      await this.startCreatorRun({ agentId, originTopicId, receiptIds: [receiptId] });
      return;
    }

    await new TaskResultCallbackRedisStore(
      this.userId,
      originTopicId,
      this.workspaceId,
    ).createPending({ agentId, callbackMessageId, operationId: receiptId });
    await this.drain(agentId, originTopicId);
  }

  /** Whether receipts are queued (and batched); see {@link queueWakeup}. */
  static canQueue(): boolean {
    return TaskResultCallbackRedisStore.isAvailable();
  }

  /**
   * Wake the topic when one of its pending receipts carries `receiptIdPrefix`
   * (a sub-topic's receipt that arrived while the topic was busy). Receipts of
   * other kinds keep the timing they always had — the sweep or their own
   * completion — unless they happen to be pending alongside.
   */
  async drainIfPending(agentId: string, originTopicId: string, receiptIdPrefix: string) {
    if (!TaskResultCallbackRedisStore.isAvailable()) return;
    const pending = await new TaskResultCallbackRedisStore(
      this.userId,
      originTopicId,
      this.workspaceId,
    ).listPendingIds();
    if (!pending.some((id) => id.startsWith(receiptIdPrefix))) return;
    await this.drain(agentId, originTopicId);
  }

  /** Claim and start one aggregated creator wakeup for the topic. */
  async drain(agentId: string, originTopicId: string): Promise<void> {
    const callbackStore = new TaskResultCallbackRedisStore(
      this.userId,
      originTopicId,
      this.workspaceId,
    );
    const receipts = await callbackStore.claimPending();
    if (receipts.length === 0) return;

    const receiptIds = receipts.map((item) => item.id);
    try {
      const creatorOperationId = await this.startCreatorRun({
        agentId,
        callbackStore,
        allTasks: receipts.every((item) => !!item.taskId),
        originTopicId,
        receiptIds,
      });
      if (creatorOperationId) {
        await callbackStore.attachCreatorOperation(receiptIds, creatorOperationId);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start creator agent';
      await callbackStore.release(receiptIds, errorMessage);
      throw error;
    }
  }

  /**
   * Start the run that processes `receiptIds` on the creator conversation.
   * Returns its operation id, or undefined when the topic could not be
   * reserved (the results stay on the main line for the next turn).
   */
  private async startCreatorRun(params: {
    agentId: string;
    /** Only task receipts: keeps the long-standing task wording of the run prompt. */
    allTasks?: boolean;
    /** Set when the receipts came from the queue; its completion re-drains it. */
    callbackStore?: TaskResultCallbackRedisStore;
    originTopicId: string;
    receiptIds: string[];
  }): Promise<string | undefined> {
    const { agentId, allTasks, callbackStore, originTopicId, receiptIds } = params;
    const topicModel = new TopicModel(this.db, this.userId, this.workspaceId);
    const topic = await topicModel.findById(originTopicId);
    const botContext = topic?.metadata?.bot as ChatTopicBotContext | undefined;
    const hooks: AgentHook[] = callbackStore
      ? [this.createCreatorCompletionHook(receiptIds, agentId, originTopicId, botContext)]
      : [];
    const reservationId = `task-result-wakeup-${receiptIds[0]}`;

    try {
      const reserved = await acquireTopicStartReservation({
        reservationId,
        topicId: originTopicId,
        topicModel,
      });
      if (!reserved) {
        await callbackStore?.settle(receiptIds);
        return;
      }

      // Receipt ordering is a queue concern, not the conversation's source of
      // truth. Re-read the live spine only after owning the topic reservation
      // so the Creator sees every callback card that landed before this run.
      const parentMessageId = await new MessageModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).getLastMainThreadSpineMessageId(originTopicId);

      // A creator wakeup continues a user-facing conversation. Preserve the
      // same approval preferences as a foreground send, including its allow
      // list. Bot channels still lack this UI/resume contract and stay headless.
      const userInterventionConfig: UserInterventionConfig = botContext
        ? { approvalMode: 'headless' }
        : await resolveForegroundInterventionConfig(this.db, this.userId);

      const result = await this.execAgent({
        agentId,
        appContext: { topicId: originTopicId },
        autoStart: true,
        botContext,
        hooks,
        parentMessageId,
        prompt: `Process ${receiptIds.length} completed ${allTasks ? 'task ' : ''}result${receiptIds.length === 1 ? '' : 's'}`,
        suppressUserMessage: true,
        topicStartReservationId: reservationId,
        trigger: RequestTrigger.TaskCallback,
        userInterventionConfig,
      });
      return result.operationId;
    } finally {
      await topicModel.releaseTaskCallbackReservation(originTopicId, reservationId);
    }
  }

  async completeCreatorWakeup(params: CompleteCreatorWakeupParams): Promise<void> {
    const callbackStore = new TaskResultCallbackRedisStore(
      this.userId,
      params.originTopicId,
      this.workspaceId,
    );
    await callbackStore.settle(params.receiptIds);
    await this.drain(params.agentId, params.originTopicId);
  }

  private createCreatorCompletionHook(
    receiptIds: string[],
    agentId: string,
    originTopicId: string,
    botContext?: ChatTopicBotContext,
  ): AgentHook {
    return {
      handler: async (event) => {
        if (botContext?.platformThreadId) {
          const callbackStore = new TaskResultCallbackRedisStore(
            this.userId,
            originTopicId,
            this.workspaceId,
          );
          const deliveredChunkCount = await callbackStore.getDeliveredChunkCount(event.operationId);
          await new BotCallbackService(this.db).handleCallback(
            {
              ...event,
              applicationId: botContext.applicationId,
              messengerInstallationKey: botContext.messengerInstallationKey,
              platformThreadId: botContext.platformThreadId,
              type: 'completion',
              userId: this.userId,
              workspaceId: this.workspaceId,
            } as BotCallbackBody,
            {
              deliveredChunkCount,
              onChunkDelivered: (count) =>
                callbackStore.markDeliveryChunk(event.operationId, count),
              strictDelivery: true,
            },
          );
        }
        await this.completeCreatorWakeup({
          agentId,
          originTopicId,
          receiptIds,
        });
      },
      id: 'task-creator-completion',
      type: 'onComplete',
      webhook: {
        body: {
          agentId,
          applicationId: botContext?.applicationId,
          messengerInstallationKey: botContext?.messengerInstallationKey,
          platformThreadId: botContext?.platformThreadId,
          receiptIds,
          originTopicId,
          type: 'completion',
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        delivery: 'qstash',
        fallback: 'none',
        url: '/api/workflows/task/on-creator-complete',
      },
    };
  }
}
