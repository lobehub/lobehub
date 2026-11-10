import type { BotPlatformContext } from '@lobechat/context-engine';
import type { BotSenderMetadata, ChatTopicBotContext, ExecAgentResult } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import debug from 'debug';

import { isAbortError } from '@/server/services/agentRuntime/abort';
import type { AiAgentService } from '@/server/services/aiAgent';

import { createBotCompletionWebhook } from '../createBotCompletionHook';
import type { BotReplyLocale, PlatformClient } from '../platforms';
import type { BridgeExecutionDeps, DiscordChannelContext, ThreadState } from './types';
import { isTopicBusyError } from './utils';

const log = debug('lobe-server:bot:agent-bridge');

/**
 * Queue mode: register hooks with webhook config, start agent, return immediately.
 */
export async function executeWithHooksQueueMode(
  deps: BridgeExecutionDeps,
  thread: Thread<ThreadState>,
  userMessage: Message,
  aiAgentService: AiAgentService,
  opts: {
    agentId: string;
    botContext?: ChatTopicBotContext;
    botPlatformContext?: BotPlatformContext;
    botSender?: BotSenderMetadata;
    callbackUrl: string;
    channelContext?: DiscordChannelContext;
    client?: PlatformClient;
    files?: any;
    progressMessage?: SentMessage;
    prompt: string;
    replyLocale: BotReplyLocale;
    toolModeOverride?: ThreadState['toolMode'];
    topicId?: string;
    trigger?: string;
    webhookBody: Record<string, unknown>;
  },
): Promise<{ reply: string; topicId: string }> {
  const {
    agentId,
    botContext,
    botPlatformContext,
    botSender,
    callbackUrl,
    channelContext,
    client,
    files,
    progressMessage,
    prompt,
    replyLocale,
    toolModeOverride,
    topicId,
    trigger,
    webhookBody,
  } = opts;

  let result: ExecAgentResult;
  try {
    result = await deps.runWithStartupSignal(thread.id, (signal) =>
      aiAgentService.execAgent({
        agentId,
        appContext: topicId ? { topicId } : undefined,
        autoStart: true,
        botContext,
        botPlatformContext,
        botSender,
        discordContext: channelContext
          ? {
              channel: channelContext.channel,
              guild: channelContext.guild,
              thread: channelContext.thread,
            }
          : undefined,
        files,
        hooks: [
          {
            handler: async () => {
              /* local handler not used in queue mode */
            },
            id: 'bot-step-progress',
            type: 'afterStep',
            webhook: {
              body: { ...webhookBody, type: 'step' },
              delivery: 'qstash',
              url: callbackUrl,
            },
          },
          {
            handler: async () => {
              /* local handler not used in queue mode */
            },
            id: 'bot-completion',
            type: 'onComplete',
            webhook: botContext
              ? createBotCompletionWebhook({
                  body: { ...webhookBody, userPrompt: prompt },
                  botContext,
                  userId: deps.userId,
                  workspaceId: deps.workspaceId,
                })
              : {
                  body: { ...webhookBody, type: 'completion', userPrompt: prompt },
                  delivery: 'qstash',
                  fallback: 'none',
                  url: callbackUrl,
                },
          },
        ],
        prompt,
        signal,
        title: '',
        toolModeOverride,
        trigger,
        userInterventionConfig: { approvalMode: 'headless' },
      }),
    );
  } catch (error) {
    log('executeWithCallback[queue]: execAgent failed: %O', error);

    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('Failed query') && errMsg.includes('topic_id')) {
      throw error;
    }
    // A cached topicId whose row vanished between the pre-flight check and
    // the topic-start reservation (delete race) surfaces as a plain
    // "Topic not found" error. Rethrow so handleSubscribedMessage can clear
    // the stale topicId and retry as a fresh mention instead of posting a
    // bare "Agent Execution Failed" with no operation id.
    if (errMsg.includes('Topic not found')) {
      throw error;
    }
    // The topic-start reservation lost against a still-running operation.
    // Rethrow so handleSubscribedMessage can defer the message for replay
    // after that run completes instead of posting a failure.
    if (isTopicBusyError(errMsg)) {
      throw error;
    }

    await deps.finishStartupFailure({
      client,
      error,
      progressMessage,
      replyLocale,
      stopped: isAbortError(error),
      thread,
      userMessage,
    });
    return { reply: '', topicId: topicId ?? '' };
  }

  if (!result.success) {
    await deps.finishStartupFailure({
      alreadyReported: result.terminalReported,
      client,
      error: result.error,
      operationId: result.operationId,
      progressMessage,
      replyLocale,
      thread,
      userMessage,
    });
    return { reply: '', topicId: result.topicId };
  }

  log(
    'executeWithCallback[queue]: operationId=%s, topicId=%s (returning immediately)',
    result.operationId,
    result.topicId,
  );

  if (result.operationId) {
    deps.activeOperations.set(thread.id, result.operationId);

    if (deps.consumeStopRequest(thread.id)) {
      try {
        await deps.interruptTrackedOperation(thread.id, result.operationId);
      } catch (error) {
        log('executeWithCallback[queue]: deferred stop failed for thread=%s: %O', thread.id, error);
      }
    }
  }

  return { reply: '', topicId: result.topicId };
}
