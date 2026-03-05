import debug from 'debug';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { TopicModel } from '@/database/models/topic';
import { verifyQStashSignature } from '@/libs/qstash';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { DiscordRestApi } from '@/server/services/bot/discordRestApi';
import {
  renderError,
  renderFinalReply,
  renderStepProgress,
  splitMessage,
} from '@/server/services/bot/replyTemplate';
import { TelegramRestApi } from '@/server/services/bot/telegramRestApi';
import { SystemAgentService } from '@/server/services/systemAgent';

const log = debug('api-route:agent:bot-callback');

// --------------- Platform-specific helpers ---------------

/**
 * Parse a Chat SDK platformThreadId (e.g. "discord:guildId:channelId[:threadId]")
 * and return the actual Discord channel ID to send messages to.
 */
function extractDiscordChannelId(platformThreadId: string): string {
  const parts = platformThreadId.split(':');
  // parts[0]='discord', parts[1]=guildId, parts[2]=channelId, parts[3]=threadId (optional)
  // When there's a Discord thread, use threadId; otherwise use channelId
  return parts[3] || parts[2];
}

/**
 * Parse a Chat SDK platformThreadId (e.g. "telegram:chatId[:messageThreadId]")
 * and return the Telegram chat ID.
 */
function extractTelegramChatId(platformThreadId: string): string {
  const parts = platformThreadId.split(':');
  // parts[0]='telegram', parts[1]=chatId
  return parts[1];
}

/**
 * Detect platform from platformThreadId prefix.
 */
function detectPlatform(platformThreadId: string): string {
  return platformThreadId.split(':')[0];
}

/** Telegram has a 4096 char limit vs Discord's 2000 */
const TELEGRAM_CHAR_LIMIT = 4000;

// --------------- Platform-agnostic message interface ---------------

interface PlatformMessenger {
  createMessage: (content: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  triggerTyping: () => Promise<void>;
  updateThreadName?: (name: string) => Promise<void>;
}

function createDiscordMessenger(
  discord: DiscordRestApi,
  channelId: string,
  platformThreadId: string,
): PlatformMessenger {
  return {
    createMessage: (content) => discord.createMessage(channelId, content).then(() => {}),
    editMessage: (messageId, content) => discord.editMessage(channelId, messageId, content),
    removeReaction: (messageId, emoji) => discord.removeOwnReaction(channelId, messageId, emoji),
    triggerTyping: () => discord.triggerTyping(channelId),
    updateThreadName: (name) => {
      const parts = platformThreadId.split(':');
      const threadId = parts[3];
      if (threadId) {
        return discord.updateChannelName(threadId, name);
      }
      return Promise.resolve();
    },
  };
}

/**
 * Parse a Chat SDK composite Telegram message ID ("chatId:messageId") into
 * the raw numeric message ID that the Telegram Bot API expects.
 */
function parseTelegramMessageId(compositeId: string): number {
  // Format: "chatId:messageId" e.g. "-100123456:42"
  const colonIdx = compositeId.lastIndexOf(':');
  if (colonIdx !== -1) {
    return Number(compositeId.slice(colonIdx + 1));
  }
  return Number(compositeId);
}

function createTelegramMessenger(telegram: TelegramRestApi, chatId: string): PlatformMessenger {
  return {
    createMessage: (content) => telegram.sendMessage(chatId, content).then(() => {}),
    editMessage: (messageId, content) =>
      telegram.editMessageText(chatId, parseTelegramMessageId(messageId), content),
    removeReaction: (messageId) =>
      telegram.removeMessageReaction(chatId, parseTelegramMessageId(messageId)),
    triggerTyping: () => telegram.sendChatAction(chatId, 'typing'),
  };
}

/**
 * Bot callback endpoint for agent step/completion webhooks.
 *
 * In queue mode, AgentRuntimeService fires webhooks (via QStash) after each step
 * and on completion. This endpoint processes those callbacks and updates
 * platform messages via REST API.
 *
 * Route: POST /api/agent/webhooks/bot-callback
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  const isValid = await verifyQStashSignature(request, rawBody);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = JSON.parse(rawBody);

  const { type, applicationId, platformThreadId, progressMessageId, userMessageId } = body;

  log(
    'bot-callback: parsed body keys=%s, type=%s, applicationId=%s, platformThreadId=%s, progressMessageId=%s',
    Object.keys(body).join(','),
    type,
    applicationId,
    platformThreadId,
    progressMessageId,
  );

  if (!type || !applicationId || !platformThreadId || !progressMessageId) {
    return NextResponse.json(
      {
        error: 'Missing required fields: type, applicationId, platformThreadId, progressMessageId',
      },
      { status: 400 },
    );
  }

  const platform = detectPlatform(platformThreadId);

  log(
    'bot-callback: type=%s, platform=%s, appId=%s, thread=%s',
    type,
    platform,
    applicationId,
    platformThreadId,
  );

  try {
    // Look up bot token from DB
    const serverDB = await getServerDB();
    const row = await AgentBotProviderModel.findByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
    );

    if (!row?.credentials) {
      log('bot-callback: no bot provider found for %s appId=%s', platform, applicationId);
      return NextResponse.json({ error: 'Bot provider not found' }, { status: 404 });
    }

    // Decrypt credentials
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse((await gateKeeper.decrypt(row.credentials)).plaintext);
    } catch {
      credentials = JSON.parse(row.credentials);
    }

    const botToken = credentials.botToken;
    if (!botToken) {
      log('bot-callback: no botToken in credentials for %s appId=%s', platform, applicationId);
      return NextResponse.json({ error: 'Bot token not found' }, { status: 500 });
    }

    // Create platform-specific messenger
    let messenger: PlatformMessenger;
    let charLimit: number | undefined;

    switch (platform) {
      case 'telegram': {
        const telegram = new TelegramRestApi(botToken);
        const chatId = extractTelegramChatId(platformThreadId);
        messenger = createTelegramMessenger(telegram, chatId);
        charLimit = TELEGRAM_CHAR_LIMIT;
        break;
      }
      case 'discord':
      default: {
        const discord = new DiscordRestApi(botToken);
        const channelId = extractDiscordChannelId(platformThreadId);
        messenger = createDiscordMessenger(discord, channelId, platformThreadId);
        break;
      }
    }

    if (type === 'step') {
      await handleStepCallback(body, messenger, progressMessageId, platform);
    } else if (type === 'completion') {
      await handleCompletionCallback(body, messenger, progressMessageId, platform, charLimit);

      // Remove eyes reaction from the original user message
      if (userMessageId) {
        try {
          await messenger.removeReaction(userMessageId, '👀');
        } catch (error) {
          log('bot-callback: failed to remove eyes reaction: %O', error);
        }
      }

      // Fire-and-forget: summarize topic title and update thread name
      const { reason, topicId, userId, userPrompt, lastAssistantContent } = body;
      if (reason !== 'error' && topicId && userId && userPrompt && lastAssistantContent) {
        const topicModel = new TopicModel(serverDB, userId);
        topicModel
          .findById(topicId)
          .then(async (topic) => {
            // Only generate when topic has an empty title
            if (topic?.title) return;

            const systemAgent = new SystemAgentService(serverDB, userId);
            const title = await systemAgent.generateTopicTitle({
              lastAssistantContent,
              userPrompt,
            });
            if (!title) return;

            await topicModel.update(topicId, { title });

            // Update thread/channel name if the platform supports it
            if (messenger.updateThreadName) {
              messenger.updateThreadName(title).catch((error) => {
                log('bot-callback: failed to update thread name: %O', error);
              });
            }
          })
          .catch((error) => {
            log('bot-callback: topic title summarization failed: %O', error);
          });
      }
    } else {
      return NextResponse.json({ error: `Unknown callback type: ${type}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('bot-callback error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}

async function handleStepCallback(
  body: Record<string, any>,
  messenger: PlatformMessenger,
  progressMessageId: string,
  platform?: string,
): Promise<void> {
  const { shouldContinue } = body;
  if (!shouldContinue) return;

  const progressText = renderStepProgress({
    content: body.content,
    elapsedMs: body.elapsedMs,
    executionTimeMs: body.executionTimeMs ?? 0,
    lastContent: body.lastLLMContent,
    lastToolsCalling: body.lastToolsCalling,
    platform,
    reasoning: body.reasoning,
    stepType: body.stepType ?? 'call_llm',
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

  // If the LLM returned text without tool calls, the next step is 'finish' — skip typing
  const isLlmFinalResponse =
    body.stepType === 'call_llm' && !body.toolsCalling?.length && body.content;

  try {
    await messenger.editMessage(progressMessageId, progressText);
    if (!isLlmFinalResponse) {
      await messenger.triggerTyping();
    }
  } catch (error) {
    log('handleStepCallback: failed to edit progress message: %O', error);
  }
}

async function handleCompletionCallback(
  body: Record<string, any>,
  messenger: PlatformMessenger,
  progressMessageId: string,
  platform?: string,
  charLimit?: number,
): Promise<void> {
  const { reason, lastAssistantContent, errorMessage } = body;

  if (reason === 'error') {
    const errorText = renderError(errorMessage || 'Agent execution failed');
    try {
      await messenger.editMessage(progressMessageId, errorText);
    } catch (error) {
      log('handleCompletionCallback: failed to edit error message: %O', error);
    }
    return;
  }

  if (!lastAssistantContent) {
    log('handleCompletionCallback: no lastAssistantContent, skipping');
    return;
  }

  const finalText = renderFinalReply(lastAssistantContent, {
    elapsedMs: body.duration,
    llmCalls: body.llmCalls ?? 0,
    platform,
    toolCalls: body.toolCalls ?? 0,
    totalCost: body.cost ?? 0,
    totalTokens: body.totalTokens ?? 0,
  });

  const chunks = splitMessage(finalText, charLimit);

  try {
    await messenger.editMessage(progressMessageId, chunks[0]);

    // Post overflow chunks as follow-up messages
    for (let i = 1; i < chunks.length; i++) {
      await messenger.createMessage(chunks[i]);
    }
  } catch (error) {
    log('handleCompletionCallback: failed to edit/post final message: %O', error);
  }
}
