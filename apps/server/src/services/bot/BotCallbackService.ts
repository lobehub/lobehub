import { randomUUID } from 'node:crypto';

import type { ChatErrorBudgetContext } from '@lobechat/types';
import debug from 'debug';

import type { MessengerPlatform } from '@/config/messenger';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { TopicModel } from '@/database/models/topic';
import { type LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  claimDeliveryChunk,
  getDeliveredChunkCount,
  releaseDeliveryLease,
} from '@/server/services/callbackDelivery';
import { getMessageGatewayClient } from '@/server/services/gateway/MessageGatewayClient';
import {
  getInstallationStore,
  messengerConnectionIdForUser,
} from '@/server/services/messenger/installations';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';
import { SystemAgentService } from '@/server/services/systemAgent';

import { AgentBridgeService } from './AgentBridgeService';
import { runDeferredReplay, scheduleDeferredReplay } from './deferredReplay';
import type {
  BotMessageAttachment,
  BotReplyLocale,
  PlatformClient,
  PlatformMessenger,
  UsageStats,
} from './platforms';
import {
  getBotReplyLocale,
  getStepReactionEmoji,
  platformFromThreadId,
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

/**
 * Render a platform delivery error for production logging WITHOUT dumping
 * the raw error object — platform SDK errors (e.g. `@discordjs/rest`
 * DiscordAPIError) carry the full `requestBody`, i.e. the user/assistant
 * message content, which must not be persisted in logs. Status/code live on
 * well-known fields; the message string from these SDKs is the API error
 * summary (e.g. "Unknown Channel"), not the payload.
 */
const describePlatformError = (error: unknown): string => {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    const code = (error as { code?: unknown }).code;
    const parts = [
      `${error.name}: ${error.message}`,
      status === undefined ? undefined : `status=${status}`,
      code === undefined ? undefined : `code=${code}`,
    ].filter(Boolean);
    return parts.join(' ');
  }
  return String(error);
};

// --------------- Callback body types ---------------

export interface BotCallbackBody {
  applicationId: string;
  /**
   * Outbound attachments (images/files) extracted from the agent's final
   * assistant message or recent tool results. Forwarded to the platform
   * messenger so platforms with attachment support (WeChat) can deliver them
   * alongside the reply text. Platforms without attachment support silently
   * drop these.
   */
  attachments?: BotMessageAttachment[];
  content?: string;
  cost?: number;
  draftId?: string;
  duration?: number;
  elapsedMs?: number;
  /**
   * Error ownership from the model-runtime error taxonomy (`user` | `provider`
   * | `harness` | `system`). Drives the user-facing error message tier when the
   * exact `errorType` has no precise copy. Forwarded verbatim from the agent
   * lifecycle event.
   */
  errorAttribution?: string;
  /**
   * Which spending allowance ran out, and by how much, when the run failed on
   * an insufficient-credits code. Lets the reply name the exhausted allowance
   * instead of the generic personal-credits copy (the figures themselves are
   * never rendered — they belong to the billed owner, not the recipient).
   * Forwarded verbatim from the agent lifecycle event.
   */
  errorBudget?: ChatErrorBudgetContext;
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
  workspaceId?: string;
}

export interface BotCallbackOptions {
  claimChunkDelivery?: (deliveredChunkCount: number) => Promise<boolean>;
  deliveredChunkCount?: number;
  durableDelivery?: boolean;
  onChunkDelivered?: (deliveredChunkCount: number) => Promise<void>;
  releaseDeliveryLease?: () => Promise<void>;
  strictDelivery?: boolean;
}

// --------------- Service ---------------

export class BotCallbackService {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  async handleCallback(body: BotCallbackBody, options?: BotCallbackOptions): Promise<void> {
    const {
      type,
      applicationId,
      platformThreadId,
      progressMessageId,
      messengerInstallationKey,
      userId,
    } = body;
    const platform = platformFromThreadId(platformThreadId);

    const { client, connectionId, messenger, charLimit, settings, workspaceId } =
      await this.createMessenger({
        applicationId,
        messengerInstallationKey,
        platform,
        platformThreadId,
        userId,
        workspaceId: body.workspaceId,
      });

    const entry = platformRegistry.getPlatform(platform);
    const canEdit = entry?.supportsMessageEdit !== false;
    const replyLocale = getBotReplyLocale(platform);

    if (type === 'step') {
      const canUpdateProgress =
        (body.draftId && messenger.updateDraft) || (canEdit && progressMessageId);
      if (settings.displayToolCalls === true && canUpdateProgress) {
        await this.handleStep(body, messenger, progressMessageId ?? '', client, replyLocale);
      } else if (body.shouldContinue && body.draftId && messenger.renewDraft) {
        try {
          await messenger.renewDraft(body.draftId);
        } catch (error) {
          log('handleCallback: failed to renew native draft: %O', error);
        }
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
      return;
    }
    if (type !== 'completion') return;

    // Stop typing on the gateway
    this.stopGatewayTyping(connectionId, platformThreadId);
    const finishCompletion = async () => {
      await this.clearStepReaction(body, client, platform);
      // Queue mode leaves the thread active until completion delivery settles.
      AgentBridgeService.clearActiveThread(platformThreadId);
      this.summarizeTopicTitle(
        { ...body, workspaceId: body.workspaceId ?? workspaceId ?? undefined },
        messenger,
      );
    };

    const draftClaim = body.draftId
      ? await messenger.claimDraftCompletion?.(body.draftId)
      : undefined;
    if (draftClaim?.status === 'busy') {
      throw new Error('Telegram draft completion is already being delivered');
    }
    if (draftClaim?.status === 'completed') {
      log('handleCallback: native draft completion already finalized, skipping duplicate');
      return;
    }
    if (body.draftId && (!draftClaim || draftClaim.status === 'missing')) {
      throw new Error('Telegram draft completion session is missing');
    }
    if (draftClaim?.status === 'finalize' && body.draftId) {
      const completed = await messenger.clearDraft?.(body.draftId);
      if (completed === false) {
        throw new Error('Telegram draft completion tombstone was not persisted');
      }
      await finishCompletion();
      return;
    }
    const leaseOwner = draftClaim?.status === 'claimed' ? draftClaim.owner : undefined;
    let deliveryOptions: BotCallbackOptions | undefined;
    try {
      deliveryOptions = await this.getDeliveryOptions(body.operationId, options);
    } catch (error) {
      if (leaseOwner && body.draftId) {
        try {
          await messenger.releaseDraftCompletion?.(body.draftId, leaseOwner);
        } catch (releaseError) {
          log('handleCallback: failed to release native draft completion claim: %O', releaseError);
        }
      }
      throw error;
    }

    try {
      const strictDelivery = deliveryOptions?.strictDelivery ?? Boolean(body.draftId);
      await this.handleCompletion(
        body,
        messenger,
        progressMessageId ?? '',
        client,
        replyLocale,
        charLimit,
        canEdit,
        strictDelivery,
        deliveryOptions?.deliveredChunkCount,
        deliveryOptions?.onChunkDelivered,
        deliveryOptions?.claimChunkDelivery,
        body.draftId,
        leaseOwner,
      );
    } catch (error) {
      if (leaseOwner && body.draftId) {
        try {
          await messenger.releaseDraftCompletion?.(body.draftId, leaseOwner);
        } catch (releaseError) {
          log('handleCallback: failed to release native draft completion claim: %O', releaseError);
        }
      }
      throw error;
    } finally {
      try {
        await deliveryOptions?.releaseDeliveryLease?.();
      } catch (error) {
        log('handleCallback: failed to release callback delivery lease: %O', error);
      }
    }
    if (body.draftId) {
      if (leaseOwner && messenger.markDraftDelivered) {
        const marked = await messenger.markDraftDelivered(body.draftId, leaseOwner);
        if (!marked) throw new Error('Telegram draft delivery lease lost');
      }
      const completed = await messenger.clearDraft?.(body.draftId, leaseOwner);
      if (completed === false) {
        throw new Error('Telegram draft completion tombstone was not persisted');
      }
    }
    await finishCompletion();
    // The topic is idle now — replay any follow-up the bridge parked while
    // this run was executing (WeChat "one image + one sentence" arrives as
    // two messages; the second used to fail the topic-start reservation).
    await this.replayDeferredMessages(
      platform,
      applicationId,
      platformThreadId,
      messengerInstallationKey,
      body.operationId ?? randomUUID(),
    );
  }

  private async replayDeferredMessages(
    platform: string,
    applicationId: string,
    platformThreadId: string,
    messengerInstallationKey: string | undefined,
    replayId: string,
  ): Promise<void> {
    const target = { applicationId, messengerInstallationKey, platform, platformThreadId };
    try {
      await runDeferredReplay(target);
    } catch (error) {
      log('replayDeferredMessages failed for thread=%s: %O', platformThreadId, error);
      // Only the replay job retries. Redelivering this completion would post
      // the already-delivered final response again.
      try {
        await scheduleDeferredReplay(target, replayId);
      } catch (scheduleError) {
        log(
          'Could not schedule deferred replay for thread=%s: %O',
          platformThreadId,
          scheduleError,
        );
      }
    }
  }

  private async getDeliveryOptions(
    operationId: string | undefined,
    options: BotCallbackOptions | undefined,
  ): Promise<BotCallbackOptions | undefined> {
    if (!operationId || options?.deliveredChunkCount !== undefined || options?.onChunkDelivered) {
      if (options?.durableDelivery && !operationId) {
        throw new Error('Completion callback is missing operationId');
      }
      return options;
    }

    const redis = getAgentRuntimeRedisClient();
    if (!redis) {
      if (options?.durableDelivery) {
        throw new Error('Durable completion delivery storage is unavailable');
      }
      return options;
    }
    const key = `bot-callback:delivery:${operationId}`;
    const deliveredChunkCount = await getDeliveredChunkCount(redis, key);
    const deliveryOwner = randomUUID();

    return {
      ...options,
      claimChunkDelivery: (count) => claimDeliveryChunk(redis, key, count, deliveryOwner),
      deliveredChunkCount,
      releaseDeliveryLease: () => releaseDeliveryLease(redis, key, deliveryOwner),
    };
  }

  private async createMessenger(params: {
    applicationId: string;
    messengerInstallationKey?: string;
    platform: string;
    platformThreadId: string;
    userId?: string;
    workspaceId?: string;
  }): Promise<{
    charLimit?: number;
    connectionId: string;
    client: PlatformClient;
    messenger: PlatformMessenger;
    settings: Record<string, unknown>;
    workspaceId?: string | null;
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
        params.workspaceId,
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
      userId: row.userId ?? userId,
    });
    const messenger = client.getMessenger(platformThreadId);

    return {
      charLimit,
      client,
      connectionId: row.id,
      messenger,
      settings,
      workspaceId: row.workspaceId,
    };
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
    workspaceId?: string,
  ): Promise<{
    charLimit?: number;
    connectionId: string;
    client: PlatformClient;
    messenger: PlatformMessenger;
    settings: Record<string, unknown>;
    workspaceId?: string;
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

    return { charLimit: undefined, client, connectionId, messenger, settings: {}, workspaceId };
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
      if (body.draftId && messenger.updateDraft) {
        await messenger.updateDraft(body.draftId, progressText);
      } else {
        await messenger.editMessage(progressMessageId, progressText);
      }
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
    strictDelivery = false,
    deliveredChunkCount = 0,
    onChunkDelivered?: (deliveredChunkCount: number) => Promise<void>,
    claimChunkDelivery?: (deliveredChunkCount: number) => Promise<boolean>,
    draftId?: string,
    leaseOwner?: string,
  ): Promise<void> {
    const renewDeliveryLease = async () => {
      if (!draftId || !leaseOwner || !messenger.renewDraftCompletion) return;
      const renewed = await messenger.renewDraftCompletion(draftId, leaseOwner);
      if (!renewed) throw new Error('Telegram draft delivery lease lost');
    };
    let deliveryLeaseLost = false;
    const heartbeat =
      draftId && leaseOwner && messenger.renewDraftCompletion
        ? setInterval(() => {
            void messenger.renewDraftCompletion!(draftId, leaseOwner).then(
              (renewed) => {
                if (!renewed) deliveryLeaseLost = true;
              },
              () => {
                deliveryLeaseLost = true;
              },
            );
          }, 30_000)
        : undefined;
    heartbeat?.unref?.();
    const assertDeliveryLease = () => {
      if (deliveryLeaseLost) throw new Error('Telegram draft delivery lease lost');
    };
    const recordChunkDelivered = async (count: number) => {
      assertDeliveryLease();
      await renewDeliveryLease();
      await onChunkDelivered?.(count);
    };
    const claimChunk = async (count: number) => {
      assertDeliveryLease();
      await renewDeliveryLease();
      return (await claimChunkDelivery?.(count)) ?? true;
    };
    const {
      reason,
      lastAssistantContent,
      errorAttribution,
      errorBudget,
      errorMessage,
      errorType,
      operationId,
      attachments,
    } = body;

    try {
      if (reason === 'error') {
        log(
          'handleCompletion: agent run failed, operationId=%s, errorType=%s, errorMessage=%s',
          operationId,
          errorType,
          errorMessage,
        );
        const errorBody = renderAgentError(
          errorType,
          errorMessage,
          operationId,
          replyLocale,
          errorAttribution,
          errorBudget,
        );
        const errorText = client.formatMarkdown?.(errorBody) ?? errorBody;
        if (deliveredChunkCount < 1 && (await claimChunk(1))) {
          const delivered = await this.deliverFirstChunk(
            messenger,
            progressMessageId,
            errorText,
            canEdit,
            undefined,
            strictDelivery,
          );
          if (delivered) await recordChunkDelivered(1);
        }
        return;
      }

      if (reason === 'interrupted') {
        if (deliveredChunkCount >= 1 || !(await claimChunk(1))) return;
        const stoppedText = renderStopped(errorMessage, replyLocale);
        try {
          await messenger.createMessage(stoppedText);
          await recordChunkDelivered(1);
        } catch (error) {
          if (strictDelivery) throw error;
          log('handleCompletion: failed to send interrupted message: %O', error);
        }
        return;
      }

      // Skip only when there's nothing at all to send. An image/file-only reply
      // (no text, but attachments present) is still a valid reply and must go
      // through — silently dropping it would mean an agent that answered with
      // just a generated image gets shown nothing on the user side.
      //
      // For the text leg: `!lastAssistantContent` lets whitespace-only strings
      // ("\n", "  ") through; those collapse to empty text downstream and get
      // rejected by Telegram as "message text is empty", silently losing the
      // reply. Trim before testing.
      const hasText = !!lastAssistantContent?.trim();
      const hasAttachments = !!attachments?.length;
      if (!hasText && !hasAttachments) {
        // console (not debug) — every one of these is a user-facing "bot went
        // silent": the run completed but the completion event
        // carried nothing to deliver. Must stay visible in production logs.
        console.error(
          `[BotCallbackService] completion had no lastAssistantContent and no attachments, skipping reply (operationId=${operationId}, topicId=${body.topicId}, thread=${body.platformThreadId})`,
        );
        if (strictDelivery)
          throw new Error('Creator callback completed without deliverable content');
        return;
      }

      const stats: UsageStats = {
        elapsedMs: body.duration,
        llmCalls: body.llmCalls ?? 0,
        toolCalls: body.toolCalls ?? 0,
        totalCost: body.cost ?? 0,
        totalTokens: body.totalTokens ?? 0,
      };

      // Build the chunk list. Empty text → a single empty chunk so the
      // attachment-only path still drives `deliverFirstChunk` once.
      let chunks: string[];
      if (hasText) {
        const msgBody = renderFinalReply(lastAssistantContent!);
        const formattedBody = client.formatMarkdown?.(msgBody) ?? msgBody;
        const finalText = client.formatReply?.(formattedBody, stats) ?? formattedBody;
        chunks = splitMessage(finalText, charLimit);
        if (chunks.length === 0) {
          log('handleCompletion: all chunks empty after formatting, skipping send');
          // Even with no text we still want to deliver the attachments.
          if (!hasAttachments) return;
          chunks = [''];
        }
      } else {
        chunks = [''];
      }

      // Attach outbound attachments to the *last* chunk only so we don't send
      // the same image/file once per chunk.
      const lastIndex = chunks.length - 1;
      const firstChunkAttachments = lastIndex === 0 ? attachments : undefined;

      if (deliveredChunkCount < 1 && (await claimChunk(1))) {
        const delivered = await this.deliverFirstChunk(
          messenger,
          progressMessageId,
          chunks[0],
          canEdit,
          firstChunkAttachments,
          strictDelivery,
        );
        if (delivered) await recordChunkDelivered(1);
      }
      // Each remaining chunk gets its own try/catch so a single transient failure
      // (rate-limit, network blip) doesn't drop everything that follows.
      for (let i = Math.max(1, deliveredChunkCount); i < chunks.length; i++) {
        try {
          if (!(await claimChunk(i + 1))) continue;
          const isLast = i === lastIndex;
          await messenger.createMessage(
            isLast && attachments?.length ? { attachments, content: chunks[i] } : chunks[i],
          );
          await recordChunkDelivered(i + 1);
        } catch (error) {
          if (strictDelivery) throw error;
          console.error(
            `[BotCallbackService] failed to send reply chunk ${i}/${lastIndex} (thread=${body.platformThreadId}): ${describePlatformError(error)}`,
          );
        }
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
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
    attachments?: BotMessageAttachment[],
    strictDelivery = false,
  ): Promise<boolean> {
    const payload = attachments && attachments.length > 0 ? { attachments, content: text } : text;

    // Telegram (and several other platforms) keep editMessage text-only.
    // Sending attachments through edit would silently drop the files.
    if (canEdit && progressMessageId && !attachments?.length) {
      try {
        await messenger.editMessage(progressMessageId, payload);
        log('completion reply delivered via editMessage: message=%s', progressMessageId);
        return true;
      } catch (error) {
        if (strictDelivery) throw error;
        log('handleCompletion: editMessage failed, falling back to createMessage: %O', error);
      }
    }
    try {
      await messenger.createMessage(payload);
      log('completion reply delivered via createMessage');
      return true;
    } catch (error) {
      // Last resort failed — the reply is lost. console (not debug) so the
      // "agent ran but no reply appeared" class of failures
      // is visible in production logs instead of an HTTP 200 with nothing.
      console.error(
        `[BotCallbackService] createMessage fallback failed, reply lost: ${describePlatformError(error)}`,
      );
      if (strictDelivery) throw error;
      return false;
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
    const client = getMessageGatewayClient(platformFromThreadId(platformThreadId));
    if (!client.isEnabled) return;

    client.startTyping(connectionId, platformThreadId).catch((err) => {
      log('renewGatewayTyping failed: %O', err);
    });
  }

  private stopGatewayTyping(connectionId: string, platformThreadId: string): void {
    if (!connectionId) return;
    const client = getMessageGatewayClient(platformFromThreadId(platformThreadId));
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
      const topicModel = new TopicModel(this.db, userId, body.workspaceId);
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

    const topicModel = new TopicModel(this.db, userId, body.workspaceId);
    topicModel
      .findById(topicId)
      .then(async (topic) => {
        if (topic?.title) return;

        const systemAgent = new SystemAgentService(this.db, userId, body.workspaceId ?? undefined);
        const title = await systemAgent.generateTopicTitle({
          lastAssistantContent,
          topicId,
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
