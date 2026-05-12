import debug from 'debug';

import type { MessengerPlatform } from '@/config/messenger';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { TopicModel } from '@/database/models/topic';
import { type LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getMessageGatewayClient } from '@/server/services/gateway/MessageGatewayClient';
import {
  getInstallationStore,
  messengerConnectionIdForUser,
} from '@/server/services/messenger/installations';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';
import { SystemAgentService } from '@/server/services/systemAgent';

import { AgentBridgeService } from './AgentBridgeService';
import type { BotReplyLocale, PlatformClient, PlatformMessenger, UsageStats } from './platforms';
import {
  getBotReplyLocale,
  getStepReactionEmoji,
  platformRegistry,
  resolveBotProviderConfig,
} from './platforms';
import { clearReactionState, getReactionState, saveReactionState } from './reactionState';
import {
  renderAgentError,
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
  errorType?: string;
  executionTimeMs?: number;
  /** Hook ID from HookDispatcher (e.g. 'bot-step-progress', 'bot-completion') */
  hookId?: string;
  /** Hook type from HookDispatcher (e.g. 'afterStep', 'onComplete') */
  hookType?: string;
  lastAssistantContent?: string;
  lastLLMContent?: string;
  lastToolsCalling?: any;
  llmCalls?: number;
  /**
   * When set, this run originated from the shared Messenger bot — credentials
   * live in the messenger installation store, not `agent_bot_providers`.
   * Format: `<platform>:<tenantId>` or `<platform>:singleton`. See
   * `ChatTopicBotContext.messengerInstallationKey`.
   */
  messengerInstallationKey?: string;
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
    const {
      type,
      applicationId,
      platformThreadId,
      progressMessageId,
      messengerInstallationKey,
      userId,
    } = body;
    const platform = platformThreadId.split(':')[0];

    const { client, connectionId, messenger, charLimit, settings } = await this.createMessenger({
      applicationId,
      messengerInstallationKey,
      platform,
      platformThreadId,
      userId,
    });

    const entry = platformRegistry.getPlatform(platform);
    const canEdit = entry?.supportsMessageEdit !== false;
    const replyLocale = getBotReplyLocale(platform);

    if (type === 'step') {
      if (canEdit && progressMessageId && settings.displayToolCalls === true) {
        await this.handleStep(body, messenger, progressMessageId, client, replyLocale);
      }
      // Swap the user-message reaction to match the current step type (tool
      // call vs. LLM reasoning). Runs regardless of `displayToolCalls` because
      // the progress-message edit and the reaction are separate UX channels.
      await this.swapStepReaction(body, client, platform);
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
        replyLocale,
        charLimit,
        canEdit,
      );
      await this.clearStepReaction(body, client, platform);
      // Clear the active thread tracker so the thread can accept new messages.
      // In queue mode, the bridge handler's finally block skips this cleanup
      // to keep the thread marked active while the agent runs on the job queue.
      AgentBridgeService.clearActiveThread(platformThreadId);
      this.summarizeTopicTitle(body, messenger);
    }
  }

  private async createMessenger(params: {
    applicationId: string;
    messengerInstallationKey?: string;
    platform: string;
    platformThreadId: string;
    userId?: string;
  }): Promise<{
    charLimit?: number;
    connectionId: string;
    client: PlatformClient;
    messenger: PlatformMessenger;
    settings: Record<string, unknown>;
  }> {
    const { applicationId, messengerInstallationKey, platform, platformThreadId, userId } = params;

    // Deterministic discriminator: any run originated from the shared
    // Messenger bot is tagged by `MessengerRouter` with the install key. We
    // never inspect the applicationId shape — that's a runtime bookkeeping
    // handle, not a routing key.
    if (messengerInstallationKey) {
      return this.createMessengerClient(
        platform,
        messengerInstallationKey,
        platformThreadId,
        userId,
      );
    }

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

  /**
   * Build a PlatformClient for messenger-originated runs. Mirrors what
   * `MessengerRouter.loadBot` does — installation store → binder.createClient —
   * but skips the Chat SDK + handler registration since the callback only
   * needs outbound messaging (edit / post / react), not webhook routing.
   *
   * `connectionId` resolves to the per-user gateway shard
   * (`messenger:<platform>[:<tenant>]:user-<userId>`) when both the install
   * key and the userId are known — that lets `stopGatewayTyping` target the
   * exact same DO that started typing in `AgentBridgeService`. Falls back to
   * `''` (typing skipped) when the userId is missing, which preserves
   * pre-PR2 behavior for any in-flight callbacks queued before the upgrade.
   */
  private async createMessengerClient(
    platform: string,
    installationKey: string,
    platformThreadId: string,
    userId?: string,
  ): Promise<{
    charLimit?: number;
    connectionId: string;
    client: PlatformClient;
    messenger: PlatformMessenger;
    settings: Record<string, unknown>;
  }> {
    const store = getInstallationStore(platform as MessengerPlatform);
    if (!store) {
      throw new Error(`Unsupported messenger platform: ${platform}`);
    }

    const creds = await store.resolveByKey(installationKey);
    if (!creds) {
      throw new Error(`Messenger install not found for ${platform} (key=${installationKey})`);
    }

    const binder = messengerPlatformRegistry.createBinder(creds);
    if (!binder) {
      throw new Error(`Messenger binder not registered for platform=${platform}`);
    }

    const client = await binder.createClient();
    if (!client) {
      throw new Error(
        `Messenger binder returned no client for ${platform} (key=${installationKey})`,
      );
    }

    const messenger = client.getMessenger(platformThreadId);

    // Pull the SystemBot's connectionMode from the messenger definition (NOT
    // `bot/platforms`) — SystemBot's transport is fixed per platform and may
    // diverge from a per-agent bot-channel provider's mode (e.g. Slack
    // SystemBot is always webhook even when a bot-channel Slack provider runs
    // Socket Mode). Websocket-singleton platforms (Discord) must target the
    // singleton DO that `AgentBridgeService` started typing on — otherwise
    // stopTyping fires at a non-existent per-user DO and never reaches the
    // live WS.
    const connectionMode = messengerPlatformRegistry.getPlatform(platform)?.connectionMode;
    const connectionId = userId
      ? messengerConnectionIdForUser({ connectionMode, installationKey, userId })
      : '';

    return { charLimit: undefined, client, connectionId, messenger, settings: {} };
  }

  private async handleStep(
    body: BotCallbackBody,
    messenger: PlatformMessenger,
    progressMessageId: string,
    client: PlatformClient,
    replyLocale: BotReplyLocale,
  ): Promise<void> {
    if (!body.shouldContinue) return;

    const msgBody = renderStepProgress(
      {
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
      },
      replyLocale,
    );

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
    replyLocale: BotReplyLocale,
    charLimit?: number,
    canEdit = true,
  ): Promise<void> {
    const { reason, lastAssistantContent, errorMessage, errorType, operationId } = body;

    if (reason === 'error') {
      log(
        'handleCompletion: agent run failed, operationId=%s, errorType=%s, errorMessage=%s',
        operationId,
        errorType,
        errorMessage,
      );
      const errorBody = renderAgentError(errorType, errorMessage, operationId, replyLocale);
      const errorText = client.formatMarkdown?.(errorBody) ?? errorBody;
      await this.deliverFirstChunk(messenger, progressMessageId, errorText, canEdit);
      return;
    }

    if (reason === 'interrupted') {
      const stoppedText = renderStopped(errorMessage, replyLocale);
      try {
        await messenger.createMessage(stoppedText);
      } catch (error) {
        log('handleCompletion: failed to send interrupted message: %O', error);
      }
      return;
    }

    // `!lastAssistantContent` lets whitespace-only strings ("\n", "  ") through;
    // those collapse to empty text downstream and get rejected by Telegram as
    // "message text is empty", silently losing the reply. Trim before testing.
    if (!lastAssistantContent?.trim()) {
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

    if (chunks.length === 0) {
      log('handleCompletion: all chunks empty after formatting, skipping send');
      return;
    }

    await this.deliverFirstChunk(messenger, progressMessageId, chunks[0], canEdit);
    // Each remaining chunk gets its own try/catch so a single transient failure
    // (rate-limit, network blip) doesn't drop everything that follows.
    for (let i = 1; i < chunks.length; i++) {
      try {
        await messenger.createMessage(chunks[i]);
      } catch (error) {
        log('handleCompletion: failed to send chunk %d: %O', i, error);
      }
    }
  }

  /**
   * Deliver the first chunk via edit when possible, else send a new message.
   * If editing fails for any reason, fall back to createMessage so the agent's
   * actual reply still reaches the user — silent edit failures were causing
   * "agent ran but no reply appeared" reports on Telegram.
   */
  private async deliverFirstChunk(
    messenger: PlatformMessenger,
    progressMessageId: string,
    text: string,
    canEdit: boolean,
  ): Promise<void> {
    if (canEdit && progressMessageId) {
      try {
        await messenger.editMessage(progressMessageId, text);
        return;
      } catch (error) {
        log('handleCompletion: editMessage failed, falling back to createMessage: %O', error);
      }
    }
    try {
      await messenger.createMessage(text);
    } catch (error) {
      log('handleCompletion: createMessage fallback failed: %O', error);
    }
  }

  /**
   * Swap the user-message reaction to match the current step type. Reads the
   * previous emoji from Redis so the remove-then-add sequence ends with only
   * one bot reaction visible. If Redis is unavailable, best-effort adds the
   * new emoji — there's nothing to remove and falling back to "stack on each
   * step" is strictly better than leaking nothing.
   */
  private async swapStepReaction(
    body: BotCallbackBody,
    client: PlatformClient,
    platform: string,
  ): Promise<void> {
    const { userMessageId, applicationId, platformThreadId } = body;
    if (!userMessageId) return;

    const desiredEmoji = getStepReactionEmoji(body.stepType, body.toolsCalling);
    const reactionThreadId =
      client.resolveReactionThreadId?.(platformThreadId, userMessageId) ?? platformThreadId;
    const messenger = client.getMessenger(reactionThreadId);

    const previous = await getReactionState(platform, applicationId, userMessageId);
    if (previous?.emoji === desiredEmoji) return;

    try {
      await messenger.replaceReaction?.(userMessageId, previous?.emoji ?? null, desiredEmoji);
    } catch (error) {
      log('swapStepReaction: failed: %O', error);
    }

    await saveReactionState(platform, applicationId, userMessageId, {
      emoji: desiredEmoji,
      reactionThreadId,
    });
  }

  /**
   * Remove whatever emoji was last applied to the user message and clear the
   * tracking state. Falls back to the legacy `👀` when no state is recorded
   * so pre-feature runs (or runs against a Redis-less setup) still clean up.
   */
  private async clearStepReaction(
    body: BotCallbackBody,
    client: PlatformClient,
    platform: string,
  ): Promise<void> {
    const { userMessageId, applicationId, platformThreadId } = body;
    if (!userMessageId) return;

    const state = await getReactionState(platform, applicationId, userMessageId);
    const emoji = state?.emoji ?? '👀';

    // Thread-starter messages may live in the parent channel (e.g. Discord),
    // so resolve the correct thread ID before obtaining the messenger.
    const reactionThreadId =
      state?.reactionThreadId ??
      client.resolveReactionThreadId?.(platformThreadId, userMessageId) ??
      platformThreadId;
    const messenger = client.getMessenger(reactionThreadId);

    try {
      await messenger.replaceReaction?.(userMessageId, emoji, null);
    } catch (error) {
      log('clearStepReaction: failed: %O', error);
    }

    await clearReactionState(platform, applicationId, userMessageId);
  }

  /**
   * Renew typing on the message-gateway. Each POST resets the 30s auto-stop timeout.
   * Fire-and-forget — typing is best-effort.
   *
   * Skipped when `connectionId` is empty (messenger-originated runs have no
   * `agent_bot_providers.id` to register against the gateway).
   */
  private renewGatewayTyping(connectionId: string, platformThreadId: string): void {
    if (!connectionId) return;
    const client = getMessageGatewayClient();
    if (!client.isEnabled) return;

    client.startTyping(connectionId, platformThreadId).catch((err) => {
      log('renewGatewayTyping failed: %O', err);
    });
  }

  private stopGatewayTyping(connectionId: string, platformThreadId: string): void {
    if (!connectionId) return;
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
