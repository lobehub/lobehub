import type { BotPlatformContext } from '@lobechat/context-engine';
import type { BotSenderMetadata, BotWakeKind, ChatTopicBotContext } from '@lobechat/types';
import type { Message, SentMessage, Thread } from 'chat';
import debug from 'debug';

import { TopicModel } from '@/database/models/topic';
import { isAbortError } from '@/server/services/agentRuntime/abort';
import type { AiAgentService } from '@/server/services/aiAgent';
import { getMessageGatewayClient } from '@/server/services/gateway/MessageGatewayClient';
import { SystemAgentService } from '@/server/services/systemAgent';

import { createBotCompletionWebhook } from '../createBotCompletionHook';
import { detectNoReply } from '../noReply';
import { recordNoReplyLabel } from '../noReplyLabel';
import type { BotReactionMode, BotReplyLocale, PlatformClient } from '../platforms';
import {
  DEFAULT_BOT_REACTION_MODE,
  getStepReactionEmoji,
  platformFromThreadId,
  shouldApplyReaction,
  THINKING_REACTION_EMOJI,
} from '../platforms';
import { renderThrownAgentError } from '../renderThrownError';
import {
  renderAgentError,
  renderFinalReply,
  renderStepProgress,
  renderStopped,
  splitMessage,
} from '../replyTemplate';
import type {
  BridgeExecutionDeps,
  BridgeExecutionResult,
  DiscordChannelContext,
  ThreadState,
} from './types';
import { extractErrorMessage, hookEventAttachmentsToChatSdk } from './utils';

const log = debug('lobe-server:bot:agent-bridge');

const EXECUTION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Local mode: register hooks with in-process handlers, wait for completion via Promise.
 */
export async function executeWithHooksLocalMode(
  deps: BridgeExecutionDeps,
  thread: Thread<ThreadState>,
  aiAgentService: AiAgentService,
  opts: {
    agentId: string;
    botContext?: ChatTopicBotContext;
    botPlatformContext?: BotPlatformContext;
    botSender?: BotSenderMetadata;
    callbackUrl: string;
    charLimit?: number;
    channelContext?: DiscordChannelContext;
    client?: PlatformClient;
    displayToolCalls?: boolean;
    files?: any;
    gatewayConnectionId?: string;
    progressMessage?: SentMessage;
    prompt: string;
    reactionMode?: BotReactionMode;
    replyLocale: BotReplyLocale;
    /**
     * Present for a `followup` wake: shows typing / the placeholder message. Held back until the
     * agent first continues past a step (it is acting, so it has decided to speak).
     */
    showFeedback?: () => Promise<{
      gatewayConnectionId?: string;
      progressMessage?: SentMessage;
    }>;
    toolModeOverride?: ThreadState['toolMode'];
    topicId?: string;
    trigger?: string;
    userMessage?: Message;
    wakeKind?: BotWakeKind;
    webhookBody: Record<string, unknown>;
  },
): Promise<BridgeExecutionResult> {
  const {
    agentId,
    botContext,
    botPlatformContext,
    botSender,
    callbackUrl,
    charLimit,
    channelContext,
    client,
    displayToolCalls,
    files,
    prompt,
    reactionMode = DEFAULT_BOT_REACTION_MODE,
    replyLocale,
    toolModeOverride,
    topicId,
    trigger,
    userMessage,
    wakeKind,
    webhookBody,
  } = opts;

  let { gatewayConnectionId, progressMessage } = opts;
  // Set while a follow-up's feedback is still held back; cleared the moment it is shown.
  let pendingShowFeedback = opts.showFeedback;

  const revealFeedback = async () => {
    const show = pendingShowFeedback;
    if (!show) return;
    pendingShowFeedback = undefined;
    ({ gatewayConnectionId, progressMessage } = await show());
    if (userMessage && shouldApplyReaction(reactionMode, 'thinking')) {
      await deps.setReaction(thread, userMessage, client, THINKING_REACTION_EMOJI, botContext);
    }
  };
  let operationStartTime = 0;
  // Tracks the last markdown body written to `progressMessage` so we can
  // skip redundant edits. Telegram rejects edits with identical content
  // ("message is not modified"), and the final reply often matches the
  // last streamed progress frame.
  let lastProgressText: string | undefined;

  const stopGatewayTyping = () => {
    if (gatewayConnectionId && botContext?.platformThreadId) {
      const gwClient = getMessageGatewayClient(platformFromThreadId(botContext.platformThreadId));
      gwClient.stopTyping(gatewayConnectionId, botContext.platformThreadId).catch((err) => {
        log('executeWithCallback[local]: gateway stopTyping failed: %O', err);
      });
    }
  };

  return new Promise<BridgeExecutionResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      stopGatewayTyping();
      reject(new Error(`Agent execution timed out`));
    }, EXECUTION_TIMEOUT);

    let resolvedTopicId = topicId ?? '';

    const getElapsedMs = () => (operationStartTime > 0 ? Date.now() - operationStartTime : 0);

    deps
      .runWithStartupSignal(thread.id, (signal) =>
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
              handler: async (event) => {
                // The agent is going on to another step (tools, more reasoning), so it is acting
                // rather than staying silent: show the feedback a follow-up deferred.
                if (event.shouldContinue) await revealFeedback();

                if (
                  event.shouldContinue &&
                  userMessage &&
                  shouldApplyReaction(reactionMode, 'step')
                ) {
                  const desiredEmoji = getStepReactionEmoji(event.stepType, event.toolsCalling);
                  await deps.setReaction(thread, userMessage, client, desiredEmoji, botContext);
                }

                if (!event.shouldContinue || !progressMessage || displayToolCalls !== true) return;

                const msgBody = renderStepProgress(
                  {
                    content: event.content,
                    elapsedMs: event.elapsedMs ?? getElapsedMs(),
                    executionTimeMs: event.executionTimeMs ?? 0,
                    lastContent: event.lastLLMContent,
                    lastToolsCalling: event.lastToolsCalling,
                    reasoning: event.reasoning,
                    stepType: (event.stepType as 'call_llm' | 'call_tool') ?? 'call_llm',
                    thinking: event.thinking ?? false,
                    toolsCalling: event.toolsCalling,
                    toolsResult: event.toolsResult,
                    totalCost: event.totalCost ?? 0,
                    totalInputTokens: event.totalInputTokens ?? 0,
                    totalOutputTokens: event.totalOutputTokens ?? 0,
                    totalSteps: event.totalSteps ?? 0,
                    totalTokens: event.totalTokens ?? 0,
                    totalToolCalls: event.totalToolCalls ?? 0,
                  },
                  replyLocale,
                );

                const stats = {
                  elapsedMs: event.elapsedMs ?? getElapsedMs(),
                  totalCost: event.totalCost ?? 0,
                  totalTokens: event.totalTokens ?? 0,
                };
                // Local mode goes through the Chat SDK adapter, which only
                // applies the platform's markdown parse_mode when the message
                // is `{ markdown }`. Pre-converting via `formatMarkdown` (HTML
                // for Telegram, mrkdwn for Slack, …) would land in a plain
                // string branch and render literal `**` / `<b>`. `formatReply`
                // only appends a plain stats line, so it composes cleanly with
                // the markdown body.
                const progressBody = client?.formatReply?.(msgBody, stats) ?? msgBody;

                if (progressBody === lastProgressText) return;

                try {
                  progressMessage = await progressMessage.edit({ markdown: progressBody });
                  lastProgressText = progressBody;
                } catch (error) {
                  log('executeWithCallback[local]: failed to edit progress message: %O', error);
                }
              },
              id: 'bot-step-progress',
              type: 'afterStep' as const,
              webhook: {
                body: { ...webhookBody, type: 'step' },
                delivery: 'qstash' as const,
                url: callbackUrl,
              },
            },
            {
              handler: async (event) => {
                clearTimeout(timeout);
                stopGatewayTyping();

                const reason = event.reason;
                log('onComplete: reason=%s', reason);

                if (reason === 'error') {
                  const errorMsg = event.errorMessage || 'Agent execution failed';
                  log(
                    'onComplete: agent run failed, operationId=%s, errorType=%s, errorMessage=%s',
                    event.operationId,
                    event.errorType,
                    errorMsg,
                  );
                  try {
                    const errorBody = renderAgentError(
                      event.errorType,
                      errorMsg,
                      event.operationId,
                      replyLocale,
                      event.errorAttribution,
                      event.errorBudget,
                      event.errorHeterogeneous,
                    );
                    // Wrap in `{ markdown }` so the Chat SDK adapter sets the
                    // platform's markdown parse_mode (e.g. Telegram `Markdown`,
                    // Slack `mrkdwn`) and converts the body. Plain strings are
                    // sent without parse_mode and would render literal `**`.
                    if (progressMessage) {
                      await progressMessage.edit({ markdown: errorBody });
                    } else {
                      await thread.post({ markdown: errorBody });
                    }
                  } catch {
                    // ignore send failure
                  }
                  // Resolve (not reject) — the friendly error has already been
                  // posted to the user. Rejecting would bubble up to the outer
                  // try/catch in handleMention and cause a duplicate generic
                  // "Agent Execution Failed" message on top of the friendly one.
                  resolve({ reply: '', topicId: resolvedTopicId });
                  return;
                }

                if (reason === 'interrupted') {
                  if (progressMessage) {
                    try {
                      await progressMessage.edit({
                        markdown: renderStopped(undefined, replyLocale),
                      });
                    } catch {
                      // ignore edit failure
                    }
                  }
                  resolve({ reply: '', topicId: resolvedTopicId });
                  return;
                }

                const lastAssistantContent = event.lastAssistantContent;
                const noReply = detectNoReply({
                  content: lastAssistantContent,
                  hasAttachments: !!(event.attachments as unknown[] | undefined)?.length,
                  wakeKind,
                });
                if (noReply) {
                  log(
                    'onComplete: no_reply reason=%s operationId=%s',
                    noReply.reason,
                    event.operationId,
                  );
                  // A placeholder only exists if the agent acted before choosing silence.
                  if (progressMessage) {
                    try {
                      await progressMessage.delete();
                    } catch (error) {
                      log(
                        'executeWithCallback[local]: failed to delete progress message: %O',
                        error,
                      );
                    }
                  }
                  if (botContext?.applicationId && userMessage) {
                    await recordNoReplyLabel(deps.db, {
                      applicationId: botContext.applicationId,
                      noReply,
                      operationId: event.operationId,
                      platform: platformFromThreadId(botContext.platformThreadId),
                      platformThreadId: botContext.platformThreadId ?? thread.id,
                      userId: deps.userId,
                      userMessageId: userMessage.id,
                      workspaceId: deps.workspaceId,
                    });
                  }
                  resolve({ noReply, reply: '', topicId: resolvedTopicId });
                  return;
                }

                try {
                  // Convert hook-event attachments (JSON-safe) to chat-sdk
                  // Attachment shape. Only the *last* chunk carries
                  // attachments so a multi-chunk reply doesn't repeat the
                  // image/file once per chunk.
                  const lastChunkAttachments = hookEventAttachmentsToChatSdk(
                    event.attachments as any,
                  );
                  const hasText = !!lastAssistantContent;
                  const hasAttachments = !!lastChunkAttachments?.length;

                  if (hasText || hasAttachments) {
                    let chunks: string[];
                    if (hasText) {
                      const replyBody = renderFinalReply(lastAssistantContent!);
                      const replyStats = {
                        elapsedMs: event.duration ?? getElapsedMs(),
                        llmCalls: event.llmCalls ?? 0,
                        toolCalls: event.toolCalls ?? 0,
                        totalCost: event.cost ?? 0,
                        totalTokens: event.totalTokens ?? 0,
                      };
                      // See progress-handler note above: keep the body as
                      // markdown and let the Chat SDK adapter render it with the
                      // platform's parse_mode. `formatReply` only appends a
                      // plain-text stats line.
                      const finalText = client?.formatReply?.(replyBody, replyStats) ?? replyBody;
                      chunks = splitMessage(finalText, charLimit);
                      if (chunks.length === 0) chunks = [''];
                    } else {
                      // Attachment-only reply — drive one empty chunk so the
                      // attachments still get posted via buildPostable.
                      chunks = [''];
                    }

                    const lastIdx = chunks.length - 1;
                    const buildPostable = (chunk: string, idx: number) =>
                      idx === lastIdx && hasAttachments
                        ? { attachments: lastChunkAttachments!, markdown: chunk }
                        : { markdown: chunk };

                    try {
                      if (progressMessage) {
                        if (chunks[0] !== lastProgressText) {
                          await progressMessage.edit(buildPostable(chunks[0], 0));
                          lastProgressText = chunks[0];
                        }
                        for (let i = 1; i < chunks.length; i++) {
                          await thread.post(buildPostable(chunks[i], i));
                        }
                      } else {
                        for (let i = 0; i < chunks.length; i++) {
                          await thread.post(buildPostable(chunks[i], i));
                        }
                      }
                    } catch (error) {
                      log('executeWithCallback[local]: failed to send final message: %O', error);
                    }

                    log(
                      'executeWithCallback[local]: got response (%d chars, %d chunks, %d attachments)',
                      lastAssistantContent?.length ?? 0,
                      chunks.length,
                      lastChunkAttachments?.length ?? 0,
                    );
                    resolve({ reply: lastAssistantContent ?? '', topicId: resolvedTopicId });

                    // Fire-and-forget: summarize topic title in DB. Only when
                    // we have text to summarize on — image-only replies skip
                    // title generation (the prompt itself still drives it on
                    // the next round).
                    if (resolvedTopicId && prompt && lastAssistantContent) {
                      const topicModel = new TopicModel(deps.db, deps.userId, deps.workspaceId);
                      topicModel
                        .findById(resolvedTopicId)
                        .then(async (topic) => {
                          if (topic?.title) return;

                          const systemAgent = new SystemAgentService(
                            deps.db,
                            deps.userId,
                            deps.workspaceId,
                          );
                          const title = await systemAgent.generateTopicTitle({
                            lastAssistantContent,
                            topicId: resolvedTopicId,
                            userPrompt: prompt,
                          });
                          if (!title) return;

                          await topicModel.update(resolvedTopicId, { title });
                        })
                        .catch((error) => {
                          log(
                            'executeWithCallback[local]: topic title summarization failed: %O',
                            error,
                          );
                        });
                    }

                    return;
                  }

                  reject(new Error('Agent completed but no response content found'));
                } catch (error) {
                  reject(error);
                }
              },
              id: 'bot-completion',
              type: 'onComplete' as const,
              webhook: botContext
                ? createBotCompletionWebhook({
                    body: { ...webhookBody, userPrompt: prompt },
                    botContext,
                    userId: deps.userId,
                    workspaceId: deps.workspaceId,
                  })
                : {
                    body: { ...webhookBody, type: 'completion', userPrompt: prompt },
                    delivery: 'qstash' as const,
                    fallback: 'none' as const,
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
      )
      .then(async (result) => {
        resolvedTopicId = result.topicId;
        operationStartTime = new Date(result.createdAt).getTime();

        if (!result.success) {
          clearTimeout(timeout);

          log(
            'executeWithCallback[local]: startup failed, operationId=%s, terminalReported=%s, error=%s',
            result.operationId,
            result.terminalReported,
            result.error,
          );

          // The terminal lifecycle already ran this failure through the
          // in-process `bot-completion` hook below, which edits the very same
          // progress message. Rendering here too would just overwrite its
          // (better-classified) copy — or, with no placeholder to edit, add a
          // second error message to the thread.
          if (progressMessage && !result.terminalReported) {
            try {
              await progressMessage.edit({
                markdown: renderThrownAgentError(result.error, result.operationId, replyLocale),
              });
            } catch (error) {
              log('executeWithCallback[local]: failed to edit startup error: %O', error);
            }
          }

          resolve({ reply: '', topicId: result.topicId });
          return;
        }

        if (result.operationId) {
          deps.activeOperations.set(thread.id, result.operationId);

          if (deps.consumeStopRequest(thread.id)) {
            try {
              await deps.interruptTrackedOperation(thread.id, result.operationId);
            } catch (error) {
              log(
                'executeWithCallback[local]: deferred stop failed for thread=%s: %O',
                thread.id,
                error,
              );
            }
          }
        }

        log(
          'executeWithCallback[local]: operationId=%s, topicId=%s',
          result.operationId,
          result.topicId,
        );
      })
      .catch(async (error) => {
        clearTimeout(timeout);

        if (isAbortError(error)) {
          if (progressMessage) {
            try {
              await progressMessage.edit({
                markdown: renderStopped(error.message, replyLocale),
              });
            } catch (editError) {
              log('executeWithCallback[local]: failed to edit stopped message: %O', editError);
            }
          }

          resolve({ reply: '', topicId: topicId ?? '' });
          return;
        }

        log('executeWithCallback[local]: startup error: %s', extractErrorMessage(error));

        // Stale cached topic: propagate so handleSubscribedMessage can clear
        // thread state and retry as a fresh mention. Queue mode does the same
        // bailout in executeWithHooksQueueMode — both the FK-violation form
        // ("Failed query" on topic_id) and the topic-start reservation form
        // ("Topic not found", a delete race after the pre-flight check).
        const errMsg = error instanceof Error ? error.message : String(error);
        if (
          (errMsg.includes('Failed query') && errMsg.includes('topic_id')) ||
          errMsg.includes('Topic not found')
        ) {
          stopGatewayTyping();
          reject(error);
          return;
        }

        // If execAgent rejected after the operation was registered (e.g. an
        // error inside the resolved-then path), the operationId may already
        // have been stashed in activeOperations — surface it so the failure
        // is traceable instead of opaque.
        const fallbackOperationId = deps.activeOperations.get(thread.id);

        if (progressMessage) {
          try {
            await progressMessage.edit({
              markdown: renderThrownAgentError(error, fallbackOperationId, replyLocale),
            });
          } catch (editError) {
            log('executeWithCallback[local]: failed to edit startup error: %O', editError);
          }
        }

        resolve({ reply: '', topicId: topicId ?? '' });
      });
  });
}
