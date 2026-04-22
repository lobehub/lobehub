import debug from 'debug';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { TopicModel } from '@/database/models/topic';
import { type LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getMessageGatewayClient } from '@/server/services/gateway/MessageGatewayClient';
import { SystemAgentService } from '@/server/services/systemAgent';

import { AgentBridgeService } from './AgentBridgeService';
import type { PlatformClient, PlatformMessenger, UsageStats } from './platforms';
import { platformRegistry, resolveBotProviderConfig } from './platforms';
import {
  renderError,
  renderFinalReply,
  renderStepProgress,
  renderStopped,
  splitMessage,
} from './replyTemplate';

const log = debug('lobe-server:bot:callback');

// --------------- Callback body types ---------------

export interface BotCallbackBody {
  applicationId: string;
  content?: string;
  cost?: number;
  duration?: number;
  elapsedMs?: number;
  errorMessage?: string;
  executionTimeMs?: number;
  /** Hook ID from HookDispatcher (e.g. 'bot-step-progress', 'bot-completion') */
  hookId?: string;
  /** Hook type from HookDispatcher (e.g. 'afterStep', 'onComplete') */
  hookType?: string;
  lastAssistantContent?: string;
  lastLLMContent?: string;
  lastToolsCalling?: any;
  llmCalls?: number;
  operationId?: string;
  platformThreadId: string;
  progressMessageId?: string;
  reason?: string;
  reasoning?: string;
  shouldContinue?: boolean;
  stepType?: 'call_llm' | 'call_tool';
  thinking?: boolean;
  /** Thread name from the platform (e.g. Discord thread title) */
  threadName?: string;
  toolCalls?: number;
  toolsCalling?: any;
  toolsResult?: any;
  topicId?: string;
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalSteps?: number;
  totalTokens?: number;
  totalToolCalls?: any;
  type: 'completion' | 'step';
  userId?: string;
  userMessageId?: string;
  userPrompt?: string;
}

// --------------- Service ---------------

export class BotCallbackService {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  async handleCallback(body: BotCallbackBody): Promise<void> {
    const { type, applicationId, platformThreadId, progressMessageId } = body;
    const platform = platformThreadId.split(':')[0];

    const { client, connectionId, messenger, charLimit, settings } = await this.createMessenger(
      platform,
      applicationId,
      platformThreadId,
    );

    const entry = platformRegistry.getPlatform(platform);
    const canEdit = entry?.supportsMessageEdit !== false;

    if (type === 'step') {
      if (canEdit && progressMessageId && settings.displayToolCalls !== false) {
        await this.handleStep(body, messenger, progressMessageId, client);
      }
      // Only renew typing when more steps are expected. The final step
      // (shouldContinue=false) may arrive after the completion callback
      // via async delivery (QStash), which would restart typing after stop.
      if (body.shouldContinue) {
        this.renewGatewayTyping(connectionId, platformThreadId);
      }
    } else if (type === 'completion') {
      // Stop typing on the gateway
      this.stopGatewayTyping(connectionId, platformThreadId);

      await this.handleCompletion(
        body,
        messenger,
        progressMessageId ?? '',
        client,
        charLimit,
        canEdit,
      );
      await this.removeEyesReaction(body, client, platformThreadId);
      // Clear the active thread tracker so the thread can accept new messages.
      // In queue mode, the bridge handler's finally block skips this cleanup
      // to keep the thread marked active while the agent runs on the job queue.
      AgentBridgeService.clearActiveThread(platformThreadId);
      this.summarizeTopicTitle(body, messenger);
    }
  }

  private async createMessenger(
    platform: string,
    applicationId: string,
    platformThreadId: string,
  ): Promise<{
    charLimit?: number;
    connectionId: string;
    client: PlatformClient;
    messenger: PlatformMessenger;
    settings: Record<string, unknown>;
  }> {
    const row = await AgentBotProviderModel.findByPlatformAndAppId(
      this.db,
      platform,
      applicationId,
    );

    if (!row?.credentials) {
      throw new Error(`Bot provider not found for ${platform} appId=${applicationId}`);
    }

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse((await gateKeeper.decrypt(row.credentials)).plaintext);
    } catch {
      credentials = JSON.parse(row.credentials);
    }

    const entry = platformRegistry.getPlatform(platform);
    if (!entry) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const { config, settings } = resolveBotProviderConfig(entry, {
      applicationId,
      credentials,
      settings: (row as any).settings as Record<string, unknown> | undefined,
    });
    const charLimit = (settings.charLimit as number) || undefined;

    const client = entry.clientFactory.createClient(config, {
      redisClient: getAgentRuntimeRedisClient() as any,
    });
    const messenger = client.getMessenger(platformThreadId);

    return { charLimit, connectionId: row.id, messenger, client, settings };
  }

  private async handleStep(
    body: BotCallbackBody,
    messenger: PlatformMessenger,
    progressMessageId: string,
    client: PlatformClient,
  ): Promise<void> {
    if (!body.shouldContinue) return;

    const msgBody = renderStepProgress({
      content: body.content,
      elapsedMs: body.elapsedMs,
      executionTimeMs: body.executionTimeMs ?? 0,
      lastContent: body.lastLLMContent,
      lastToolsCalling: body.lastToolsCalling,
      reasoning: body.reasoning,
      stepType: body.stepType ?? ('call_llm' as const),
      thinking: body.thinking ?? false,
      toolsCalling: body.toolsCalling,
      toolsResult: body.toolsResult,
      totalCost: body.totalCost ?? 0,
      totalInputTokens: body.totalInputTokens ?? 0,
      totalOutputTokens: body.totalOutputTokens ?? 0,
      totalSteps: body.totalSteps ?? 0,
      totalTokens: body.totalTokens ?? 0,
      totalToolCalls: body.totalToolCalls,
    });

    const stats: UsageStats = {
      elapsedMs: body.elapsedMs,
      totalCost: body.totalCost ?? 0,
      totalTokens: body.totalTokens ?? 0,
    };

    const formatted = client.formatMarkdown?.(msgBody) ?? msgBody;
    const progressText = client.formatReply?.(formatted, stats) ?? formatted;

    const isLlmFinalResponse =
      body.stepType === 'call_llm' && !body.toolsCalling?.length && body.content;

    try {
      await messenger.editMessage(progressMessageId, progressText);
      if (!isLlmFinalResponse) {
        await messenger.triggerTyping?.();
      }
    } catch (error) {
      log('handleStep: failed to edit progress message: %O', error);
    }
  }

  private async handleCompletion(
    body: BotCallbackBody,
    messenger: PlatformMessenger,
    progressMessageId: string,
    client: PlatformClient,
    charLimit?: number,
    canEdit = true,
  ): Promise<void> {
    const { reason, lastAssistantContent, errorMessage, operationId } = body;

    if (reason === 'error') {
      log(
        'handleCompletion: agent run failed, operationId=%s, errorMessage=%s',
        operationId,
        errorMessage,
      );
      const errorText = renderError(operationId);
      try {
        if (canEdit && progressMessageId) {
          await messenger.editMessage(progressMessageId, errorText);
        } else {
          await messenger.createMessage(errorText);
        }
      } catch (error) {
        log('handleCompletion: failed to send error message: %O', error);
      }
      return;
    }

    if (reason === 'interrupted') {
      const stoppedText = renderStopped(errorMessage || 'Execution stopped.');
      try {
        await messenger.createMessage(stoppedText);
      } catch (error) {
        log('handleCompletion: failed to send interrupted message: %O', error);
      }
      return;
    }

    if (!lastAssistantContent) {
      log('handleCompletion: no lastAssistantContent, skipping');
      return;
    }

    const msgBody = renderFinalReply(lastAssistantContent);

    const stats: UsageStats = {
      elapsedMs: body.duration,
      llmCalls: body.llmCalls ?? 0,
      toolCalls: body.toolCalls ?? 0,
      totalCost: body.cost ?? 0,
      totalTokens: body.totalTokens ?? 0,
    };

    const formattedBody = client.formatMarkdown?.(msgBody) ?? msgBody;
    const finalText = client.formatReply?.(formattedBody, stats) ?? formattedBody;
    const chunks = splitMessage(finalText, charLimit);

    try {
      if (canEdit && progressMessageId) {
        await messenger.editMessage(progressMessageId, chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await messenger.createMessage(chunks[i]);
        }
      } else {
        // No progress message to edit or platform doesn't support edit — send all chunks as new messages
        for (const chunk of chunks) {
          await messenger.createMessage(chunk);
        }
      }
    } catch (error) {
      log('handleCompletion: failed to send final message: %O', error);
    }
  }

  private async removeEyesReaction(
    body: BotCallbackBody,
    client: PlatformClient,
    platformThreadId: string,
  ): Promise<void> {
    const { userMessageId } = body;
    if (!userMessageId) return;

    // Thread-starter messages may live in the parent channel (e.g. Discord),
    // so resolve the correct thread ID before obtaining the messenger.
    const reactionThreadId =
      client.resolveReactionThreadId?.(platformThreadId, userMessageId) ?? platformThreadId;
    const messenger = client.getMessenger(reactionThreadId);

    try {
      await messenger.removeReaction(userMessageId, '👀');
    } catch (error) {
      log('removeEyesReaction: failed: %O', error);
    }
  }

  /**
   * Renew typing on the message-gateway. Each POST resets the 30s auto-stop timeout.
   * Fire-and-forget — typing is best-effort.
   */
  private renewGatewayTyping(connectionId: string, platformThreadId: string): void {
    const client = getMessageGatewayClient();
    if (!client.isEnabled) return;

    client.startTyping(connectionId, platformThreadId).catch((err) => {
      log('renewGatewayTyping failed: %O', err);
    });
  }

  private stopGatewayTyping(connectionId: string, platformThreadId: string): void {
    const client = getMessageGatewayClient();
    if (!client.isEnabled) return;

    client.stopTyping(connectionId, platformThreadId).catch((err) => {
      log('stopGatewayTyping failed: %O', err);
    });
  }

  private summarizeTopicTitle(body: BotCallbackBody, messenger: PlatformMessenger): void {
    const { reason, topicId, userId, userPrompt, lastAssistantContent, threadName } = body;
    if (
      reason === 'error' ||
      reason === 'interrupted' ||
      !topicId ||
      !userId ||
      !userPrompt ||
      !lastAssistantContent
    ) {
      return;
    }

    // Thread already has a user-set name — use it as topic title, skip LLM generation
    if (threadName) {
      const topicModel = new TopicModel(this.db, userId);
      topicModel
        .findById(topicId)
        .then(async (topic) => {
          if (topic?.title) return;
          await topicModel.update(topicId, { title: threadName });
        })
        .catch((error) => {
          log('summarizeTopicTitle: failed to set thread name as topic title: %O', error);
        });
      return;
    }

    const topicModel = new TopicModel(this.db, userId);
    topicModel
      .findById(topicId)
      .then(async (topic) => {
        if (topic?.title) return;

        const systemAgent = new SystemAgentService(this.db, userId);
        const title = await systemAgent.generateTopicTitle({
          lastAssistantContent,
          userPrompt,
        });
        if (!title) return;

        await topicModel.update(topicId, { title });

        if (messenger.updateThreadName) {
          messenger.updateThreadName(title).catch((error) => {
            log('summarizeTopicTitle: failed to update thread name: %O', error);
          });
        }
      })
      .catch((error) => {
        log('summarizeTopicTitle: failed: %O', error);
      });
  }
}
