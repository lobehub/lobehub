import {
  type AgentEvent,
  type AgentInstruction,
  type InstructionExecutor,
  UsageCounter,
} from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildExecuteToolAttributes,
  buildExecuteToolResultAttributes,
  executeToolSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import pMap from 'p-map';

import {
  type DeviceAccessReason,
  isDeviceToolIdentifier,
  logDeviceToolAudit,
} from '@/server/services/aiAgent/deviceToolAudit';
import { type ToolExecutionResultResponse } from '@/server/services/toolExecution';

import { type RuntimeExecutorContext } from '../context';
import { dispatchClientTool } from '../dispatchClientTool';
import {
  archiveRuntimeToolResult,
  buildPostProcessUrl,
  buildServerAgentMemberRunner,
  buildServerVirtualSubAgentRunner,
  executeToolWithRetry,
  GEN_AI_FUNCTION_TOOL_TYPE,
  isOperationInterrupted,
  log,
  TOOL_MAX_RETRIES,
  TOOL_PRICING,
} from '../executorHelpers';
import { formatErrorEventData } from '../formatErrorEventData';
import {
  createConversationParentMissingError,
  isMidOperationReferenceMissingError,
  isPersistFatal,
  markPersistFatal,
} from '../messagePersistErrors';
import { resolveToolTimeoutMs } from '../resolveToolTimeout';

export const callToolsBatch =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tools_batch' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const operationLogId = `${operationId}:${stepIndex}`;
    log(
      `[${operationLogId}][call_tools_batch] Starting batch execution for ${toolsCalling.length} tools`,
    );

    // Split client vs server tools
    const clientTools: ChatToolPayload[] = [];
    const serverTools: ChatToolPayload[] = [];
    for (const tp of toolsCalling) {
      const src =
        state.operationToolSet?.sourceMap?.[tp.identifier] ?? state.toolSourceMap?.[tp.identifier];
      if (src === 'client') {
        clientTools.push(tp);
      } else {
        serverTools.push(tp);
      }
    }

    // If all tools are client-side, pause immediately
    if (clientTools.length > 0 && serverTools.length === 0) {
      log(
        `[${operationLogId}][call_tools_batch] All ${clientTools.length} tools are client-side, pausing`,
      );

      await streamManager.publishStreamChunk(operationId, stepIndex, {
        chunkType: 'tools_calling',
        toolsCalling: clientTools as any,
      });

      const newState = structuredClone(state);
      newState.lastModified = new Date().toISOString();
      newState.status = 'waiting_for_async_tool';
      newState.interruption = {
        canResume: true,
        interruptedAt: new Date().toISOString(),
        reason: 'client_tool_execution',
      };
      newState.pendingToolsCalling = clientTools;

      return {
        events: [
          {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: 'client_tool_execution',
            type: 'interrupted',
          },
        ],
        newState,
      };
    }

    // Track all tool message IDs created during execution
    const toolMessageIds: string[] = [];
    const toolResults: any[] = [];
    // Deferred (async) tools whose result is delivered out-of-band later;
    // collected here so the batch parks for them after server tools finish.
    const deferredTools: ChatToolPayload[] = [];

    // Execute server tools concurrently (skip client tools in mixed batch)
    const toolsToExecute = serverTools.length > 0 ? serverTools : toolsCalling;
    await pMap(
      toolsToExecute,
      async (chatToolPayload: ChatToolPayload) => {
        const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;

        // Publish tool execution start event
        await streamManager.publishStreamEvent(operationId, {
          data: { parentMessageId, toolCalling: chatToolPayload },
          stepIndex,
          type: 'tool_start',
        });

        const batchToolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;
        const batchExistingStats = state.usage?.tools?.byTool?.find(
          (t) => t.name === batchToolName,
        );
        const batchCallIndex = (batchExistingStats?.calls ?? 0) + 1;
        let batchParsedArgs: Record<string, any> = {};
        try {
          batchParsedArgs =
            typeof chatToolPayload.arguments === 'string'
              ? JSON.parse(chatToolPayload.arguments)
              : (chatToolPayload.arguments ?? {});
        } catch {
          // Keep malformed tool arguments as an empty preview payload; execution still uses raw args.
        }

        // OTel execute_tool span — one per tool inside the concurrent batch.
        const batchToolSourceForSpan =
          state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
          state.toolSourceMap?.[chatToolPayload.identifier];
        const batchExecuteToolSpan = agentRuntimeTracer.startSpan(executeToolSpanName(toolName), {
          attributes: buildExecuteToolAttributes({
            operationId,
            stepIndex,
            toolCallId: chatToolPayload.id,
            toolName,
            toolSource: batchToolSourceForSpan,
            toolType: GEN_AI_FUNCTION_TOOL_TYPE,
          }),
        });

        try {
          try {
            log(`[${operationLogId}] Executing tool ${toolName} ...`);
            // Build effective manifest map (operation + step-level activations)
            const batchManifestMap = {
              ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
              ...Object.fromEntries(
                (state.activatedStepTools ?? [])
                  .filter((a) => a.manifest)
                  .map((a) => [a.id, a.manifest!]),
              ),
            };

            const batchAgentConfig = state.metadata?.agentConfig;

            const canDispatchToClient =
              chatToolPayload.executor === 'client' &&
              typeof streamManager.sendToolExecute === 'function';

            let batchToolCallMocked = false;
            const batchHookResult = ctx.hookDispatcher
              ? await (async () => {
                  ctx
                    .hookDispatcher!.dispatch(
                      operationId,
                      'beforeToolCall',
                      {
                        apiName: chatToolPayload.apiName,
                        args: batchParsedArgs,
                        callIndex: batchCallIndex,
                        identifier: chatToolPayload.identifier,
                        operationId,
                        stepIndex,
                        userId: ctx.userId,
                      },
                      state.metadata?._hooks,
                    )
                    .catch(() => {});
                  return ctx.hookDispatcher!.dispatchBeforeToolCall(operationId, {
                    apiName: chatToolPayload.apiName,
                    args: batchParsedArgs,
                    callIndex: batchCallIndex,
                    identifier: chatToolPayload.identifier,
                    stepIndex,
                  });
                })()
              : null;

            if (isDeviceToolIdentifier(chatToolPayload.identifier) && !batchHookResult?.isMocked) {
              const policy = state.metadata?.deviceAccessPolicy as
                { canUseDevice: boolean; reason: DeviceAccessReason } | undefined;
              logDeviceToolAudit({
                apiName: chatToolPayload.apiName,
                botContext: state.metadata?.botContext,
                canUseDevice: policy?.canUseDevice ?? true,
                messageId: state.metadata?.sourceMessageId,
                operationId,
                reason: policy?.reason ?? 'first-party',
                toolIdentifier: chatToolPayload.identifier,
                topicId: ctx.topicId,
                userId: ctx.userId,
              });
            }

            let execution: { result: ToolExecutionResultResponse; attempts: number };
            if (batchHookResult?.isMocked) {
              log(`[${operationLogId}] Tool ${toolName} mocked by beforeToolCall hook`);
              batchToolCallMocked = true;
              execution = {
                attempts: 0,
                result: { content: batchHookResult.content, executionTime: 0, success: true },
              };
            } else if (canDispatchToClient) {
              log(`[${operationLogId}] Dispatching tool ${toolName} to client via Agent Gateway`);
              const timeoutMs = resolveToolTimeoutMs({
                apiName: chatToolPayload.apiName,
                args: batchParsedArgs,
                manifest: batchManifestMap[chatToolPayload.identifier],
              });
              const dispatchResult = await dispatchClientTool(chatToolPayload, {
                operationId,
                streamManager,
                timeoutMs,
              });
              execution = { attempts: 1, result: dispatchResult };
            } else {
              // Inject source from sourceMap so BuiltinToolsExecutor can route
              // lobehubSkill / composio tools correctly (LLM responses don't carry source)
              const batchToolSource =
                state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
                state.toolSourceMap?.[chatToolPayload.identifier];
              if (batchToolSource && !chatToolPayload.source) {
                chatToolPayload.source = batchToolSource;
              }

              const timeoutMs = resolveToolTimeoutMs({
                apiName: chatToolPayload.apiName,
                args: batchParsedArgs,
                manifest: batchManifestMap[chatToolPayload.identifier],
              });

              execution = await executeToolWithRetry(
                () =>
                  toolExecutionService.executeTool(chatToolPayload, {
                    activeDeviceId: state.metadata?.activeDeviceId,
                    agentId: state.metadata?.agentId,
                    agentMember: buildServerAgentMemberRunner(
                      ctx,
                      state,
                      chatToolPayload,
                      payload.parentMessageId,
                    ),
                    // Assistant message owning this tool call (≠ source user message).
                    assistantMessageId: payload.parentMessageId,
                    documentId: state.metadata?.documentId,
                    execSubAgent: ctx.execSubAgent,
                    executionTimeoutMs: timeoutMs,
                    groupId: state.metadata?.groupId,
                    isSubAgent: state.metadata?.isSubAgent === true,
                    memoryToolPermission: batchAgentConfig?.chatConfig?.memory?.toolPermission,
                    messageId: state.metadata?.sourceMessageId,
                    operationId,
                    scope: state.metadata?.scope,
                    serverDB: ctx.serverDB,
                    skipResultTruncation: true,
                    subAgent: buildServerVirtualSubAgentRunner(
                      ctx,
                      state,
                      chatToolPayload,
                      payload.parentMessageId,
                    ),
                    taskId: state.metadata?.taskId,
                    threadId: state.metadata?.threadId,
                    toolCallId: chatToolPayload.id,
                    toolManifestMap: batchManifestMap,
                    toolResultMaxLength: batchAgentConfig?.chatConfig?.toolResultMaxLength,
                    topicId: ctx.topicId,
                    userId: ctx.userId,
                    workspaceId: state.metadata?.workspaceId ?? ctx.workspaceId,
                  }),
                {
                  isInterrupted: () => isOperationInterrupted(ctx),
                  maxRetries: TOOL_MAX_RETRIES,
                  operationLogId,
                  toolName,
                },
              );
            }

            // Deferred (async) tool: executor created a pending placeholder and
            // the real result arrives out-of-band. Skip the tool_result write;
            // the batch parks for it after all server tools settle.
            if (execution.result.deferred) {
              log(`[${operationLogId}] Tool ${toolName} deferred; will park after batch`);
              deferredTools.push(chatToolPayload);
              batchExecuteToolSpan.setAttributes(
                buildExecuteToolResultAttributes({ attempts: execution.attempts, success: true }),
              );
              return;
            }

            const executionResult = await archiveRuntimeToolResult(execution.result, {
              agentId: state.metadata?.agentId,
              identifier: chatToolPayload.identifier,
              limit: batchAgentConfig?.chatConfig?.toolResultMaxLength,
              serverDB: ctx.serverDB,
              toolCallId: chatToolPayload.id,
              topicId: ctx.topicId ?? state.metadata?.topicId,
              userId: ctx.userId,
              workspaceId: state.metadata?.workspaceId ?? ctx.workspaceId,
            });
            const executionTime = executionResult.executionTime;
            const isSuccess = executionResult.success;
            if (ctx.hookDispatcher) {
              ctx.hookDispatcher
                .dispatch(
                  operationId,
                  'afterToolCall',
                  {
                    apiName: chatToolPayload.apiName,
                    args: batchParsedArgs,
                    callIndex: batchCallIndex,
                    content: executionResult.content,
                    executionTimeMs: executionTime,
                    identifier: chatToolPayload.identifier,
                    mocked: batchToolCallMocked,
                    operationId,
                    stepIndex,
                    success: isSuccess,
                    userId: ctx.userId,
                  },
                  state.metadata?._hooks,
                )
                .catch(() => {});
            }
            log(
              `[${operationLogId}] Executed ${toolName} in ${executionTime}ms, success: ${isSuccess}`,
            );

            // Publish tool execution result event
            await streamManager.publishStreamEvent(operationId, {
              data: {
                executionTime,
                isSuccess,
                attempts: execution.attempts,
                maxAttempts: TOOL_MAX_RETRIES + 1,
                payload: { parentMessageId, toolCalling: chatToolPayload },
                phase: 'tool_execution',
                result: executionResult,
              },
              stepIndex,
              type: 'tool_end',
            });

            // Create tool message in database
            try {
              const toolMessage = await ctx.messageModel.create({
                agentId: state.metadata!.agentId!,
                content: executionResult.content,
                groupId: state.metadata?.groupId ?? undefined,
                metadata: { toolExecutionTimeMs: executionTime },
                parentId: parentMessageId,
                plugin: chatToolPayload as any,
                pluginError: executionResult.error,
                pluginState: executionResult.state,
                role: 'tool',
                threadId: state.metadata?.threadId,
                tool_call_id: chatToolPayload.id,
                topicId: state.metadata?.topicId,
              });
              toolMessageIds.push(toolMessage.id);
              log(`[${operationLogId}] Created tool message ${toolMessage.id} for ${toolName}`);
            } catch (error) {
              console.error(
                `[${operationLogId}] Failed to create tool message for ${toolName}:`,
                error,
              );
              // Normalize BEFORE publishing — clients treat `error` stream
              // events as terminal and surface `event.data.error` directly, so
              // a raw SQL error here would leak driver text to the user before
              // the ConversationParentMissing throw is consumed. See .
              const fatal = isMidOperationReferenceMissingError(error)
                ? createConversationParentMissingError(parentMessageId, error)
                : error instanceof Error
                  ? error
                  : new Error(String(error));
              await streamManager.publishStreamEvent(operationId, {
                data: formatErrorEventData(fatal, 'tool_message_persist'),
                stepIndex,
                type: 'error',
              });
              // Marker so the outer catch (which normally just records
              // per-tool exec errors) knows to propagate this one.
              throw markPersistFatal(fatal);
            }

            // Collect tool result
            toolResults.push({
              data: executionResult,
              executionTime,
              isSuccess,
              toolCall: chatToolPayload,
              toolCallId: chatToolPayload.id,
            });

            events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

            // Collect per-tool usage for post-batch accumulation
            const toolCost = TOOL_PRICING[toolName] || 0;
            toolResults.at(-1).usageParams = {
              executionTime,
              success: isSuccess,
              toolCost,
              toolName,
            };

            batchExecuteToolSpan.setAttributes(
              buildExecuteToolResultAttributes({
                attempts: execution.attempts,
                success: isSuccess,
              }),
            );
          } catch (error) {
            batchExecuteToolSpan.recordException(error as Error);
            batchExecuteToolSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            batchExecuteToolSpan.setAttributes(
              buildExecuteToolResultAttributes({ success: false }),
            );

            // Persist-level failures (e.g. parent FK violations) must propagate
            // so the whole batch short-circuits. Without this the fallback to
            // the already-deleted parent triggers another FK on the next step.
            if (isPersistFatal(error)) {
              throw error;
            }

            if (ctx.hookDispatcher) {
              ctx.hookDispatcher
                .dispatch(
                  operationId,
                  'onToolCallError',
                  {
                    apiName: chatToolPayload.apiName,
                    args: batchParsedArgs,
                    callIndex: batchCallIndex,
                    error: error instanceof Error ? error.message : String(error),
                    identifier: chatToolPayload.identifier,
                    operationId,
                    stepIndex,
                    userId: ctx.userId,
                  },
                  state.metadata?._hooks,
                )
                .catch(() => {});
            }

            console.error(`[${operationLogId}] Tool execution failed for ${toolName}:`, error);

            // Publish error event
            await streamManager.publishStreamEvent(operationId, {
              data: formatErrorEventData(error, 'tool_execution'),
              stepIndex,
              type: 'error',
            });

            events.push({ error, type: 'error' });
          }
        } finally {
          batchExecuteToolSpan.end();
        }
      },
      { concurrency: 5 },
    );

    log(
      `[${operationLogId}][call_tools_batch] All tools executed, created ${toolMessageIds.length} tool messages`,
    );

    // Accumulate tool usage sequentially after all tools have finished
    const newState = structuredClone(state);
    for (const result of toolResults) {
      if (result.usageParams) {
        const { usage, cost } = UsageCounter.accumulateTool({
          ...result.usageParams,
          cost: newState.cost,
          usage: newState.usage,
        });
        newState.usage = usage;
        if (cost) newState.cost = cost;
      }
    }

    // Persist ToolsActivator discovery results from batch tool executions
    const batchEffectiveManifestMap = {
      ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
      ...Object.fromEntries(
        (state.activatedStepTools ?? []).filter((a) => a.manifest).map((a) => [a.id, a.manifest!]),
      ),
    };
    const existingActivationIds = new Set(
      (newState.activatedStepTools ?? []).map((t: { id: string }) => t.id),
    );
    for (const result of toolResults) {
      const discovered = result.data?.state?.activatedTools as
        Array<{ identifier: string }> | undefined;
      if (discovered?.length) {
        const newActivations = discovered
          .filter((t) => !existingActivationIds.has(t.identifier))
          .map((t) => ({
            activatedAtStep: state.stepCount,
            id: t.identifier,
            manifest: batchEffectiveManifestMap[t.identifier],
            source: 'discovery' as const,
          }));

        for (const activation of newActivations) {
          existingActivationIds.add(activation.id);
        }

        if (newActivations.length > 0) {
          newState.activatedStepTools = [...(newState.activatedStepTools ?? []), ...newActivations];
        }
      }
    }

    // Refresh messages from database to ensure state is in sync

    // Query latest messages from database
    // Must pass agentId to ensure correct query scope, otherwise when topicId is undefined,
    // the query will use isNull(topicId) condition which won't find messages with actual topicId
    //
    // postProcessUrl resolves keys in imageList/videoList/fileList to external URLs;
    // without it the next LLM call sees raw keys and providers reject them.
    const latestMessages = await ctx.messageModel.query(
      {
        agentId: state.metadata?.agentId,
        // Group runs must pass groupId, else the query falls into the standard
        // branch (`groupId IS NULL`) and returns zero group messages — the next
        // call_llm step then gets an empty context and the provider rejects it
        // ("at least one message is required").
        groupId: state.metadata?.groupId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      },
      { postProcessUrl: buildPostProcessUrl(ctx) },
    );

    // Use conversation-flow parse to resolve branching into linear flat list
    // parse() handles assistantGroup, compare, supervisor, etc. virtual message types
    const { flatList } = parse(latestMessages);
    newState.messages = flatList;

    log(
      `[${operationLogId}][call_tools_batch] Refreshed ${newState.messages.length} messages from database`,
    );

    // Get the last tool message ID as parentMessageId for next LLM call
    const lastToolMessageId = toolMessageIds.at(-1);

    // Park if any tools still owe an out-of-band result: client tools (run on
    // the client) and/or deferred async tools (e.g. sub-agents). The operation
    // resumes once every pending tool's result is delivered.
    const pendingTools = [...deferredTools, ...clientTools];
    if (pendingTools.length > 0) {
      // Prefer the async-tool reason when any deferred tool is present; the
      // individual pending payloads still carry their own identity for the
      // resume gate.
      const pauseReason = deferredTools.length > 0 ? 'async_tool' : 'client_tool_execution';
      log(
        `[${operationLogId}][call_tools_batch] Pausing after ${serverTools.length} server tools: ${deferredTools.length} deferred + ${clientTools.length} client`,
      );

      await streamManager.publishStreamChunk(operationId, stepIndex, {
        chunkType: 'tools_calling',
        toolsCalling: pendingTools as any,
      });

      newState.status = 'waiting_for_async_tool';
      newState.interruption = {
        canResume: true,
        interruptedAt: new Date().toISOString(),
        reason: pauseReason,
      };
      newState.pendingToolsCalling = pendingTools;

      return {
        events: [
          ...events,
          {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: pauseReason,
            type: 'interrupted',
          },
        ],
        newState,
      };
    }

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId: lastToolMessageId ?? parentMessageId,
          toolCount: toolsCalling.length,
          toolResults,
        },
        phase: 'tools_batch_result',
        session: {
          eventCount: events.length,
          messageCount: newState.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      },
    };
  };
