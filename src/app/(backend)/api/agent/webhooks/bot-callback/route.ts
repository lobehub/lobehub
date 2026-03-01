import debug from 'debug';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { verifyQStashSignature } from '@/libs/qstash';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { DiscordRestApi } from '@/server/services/bot/discordRestApi';
import {
  renderError,
  renderFinalReply,
  renderStepProgress,
  splitMessage,
} from '@/server/services/bot/replyTemplate';

const log = debug('api-route:agent:bot-callback');

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
 * Bot callback endpoint for agent step/completion webhooks.
 *
 * In queue mode, AgentRuntimeService fires webhooks (via QStash) after each step
 * and on completion. This endpoint processes those callbacks and updates
 * Discord messages via REST API.
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

  const { type, applicationId, platformThreadId, progressMessageId } = body;

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

  log('bot-callback: type=%s, appId=%s, thread=%s', type, applicationId, platformThreadId);

  try {
    // Look up bot token from DB
    const serverDB = await getServerDB();
    const row = await AgentBotProviderModel.findByPlatformAndAppId(
      serverDB,
      'discord',
      applicationId,
    );

    if (!row?.credentials) {
      log('bot-callback: no bot provider found for appId=%s', applicationId);
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
      log('bot-callback: no botToken in credentials for appId=%s', applicationId);
      return NextResponse.json({ error: 'Bot token not found' }, { status: 500 });
    }

    const discord = new DiscordRestApi(botToken);
    const channelId = extractDiscordChannelId(platformThreadId);

    if (type === 'step') {
      await handleStepCallback(body, discord, channelId, progressMessageId);
    } else if (type === 'completion') {
      await handleCompletionCallback(body, discord, channelId, progressMessageId);
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
  discord: DiscordRestApi,
  channelId: string,
  progressMessageId: string,
): Promise<void> {
  const { shouldContinue } = body;
  if (!shouldContinue) return;

  const progressText = renderStepProgress({
    content: body.content,
    elapsedMs: body.elapsedMs,
    executionTimeMs: body.executionTimeMs ?? 0,
    lastContent: body.lastLLMContent,
    lastToolsCalling: body.lastToolsCalling,
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

  try {
    await discord.editMessage(channelId, progressMessageId, progressText);
  } catch (error) {
    log('handleStepCallback: failed to edit progress message: %O', error);
  }
}

async function handleCompletionCallback(
  body: Record<string, any>,
  discord: DiscordRestApi,
  channelId: string,
  progressMessageId: string,
): Promise<void> {
  const { reason, lastAssistantContent, errorMessage } = body;

  if (reason === 'error') {
    const errorText = renderError(errorMessage || 'Agent execution failed');
    try {
      await discord.editMessage(channelId, progressMessageId, errorText);
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
    toolCalls: body.toolCalls ?? 0,
    totalCost: body.cost ?? 0,
    totalTokens: body.totalTokens ?? 0,
  });

  const chunks = splitMessage(finalText);

  try {
    await discord.editMessage(channelId, progressMessageId, chunks[0]);

    // Post overflow chunks as follow-up messages
    for (let i = 1; i < chunks.length; i++) {
      await discord.createMessage(channelId, chunks[i]);
    }
  } catch (error) {
    log('handleCompletionCallback: failed to edit/post final message: %O', error);
  }
}
