import {
  type AgentEvent,
  type AgentInstruction,
  type InstructionExecutor,
  UsageCounter,
} from '@lobechat/agent-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildExecuteToolAttributes,
  buildExecuteToolResultAttributes,
  executeToolSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
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

export const callTool =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const operationLogId = `${operationId}:${stepIndex}`;
    log(`[${operationLogId}] payload: %O`, payload);

    // Publish tool execution start event
    await streamManager.publishStreamEvent(operationId, {
      data: payload,
      stepIndex,
      type: 'tool_start',
    });

    // payload is { parentMessageId, toolCalling: ChatToolPayload }
    const chatToolPayload: ChatToolPayload = payload.toolCalling;

    const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;
    const existingToolStats = state.usage?.tools?.byTool?.find((t) => t.name === toolName);
    const callIndex = (existingToolStats?.calls ?? 0) + 1;

    let parsedArgs: Record<string, any> = {};
    try {
      parsedArgs =
        typeof chatToolPayload.arguments === 'string'
          ? JSON.parse(chatToolPayload.arguments)
          : (chatToolPayload.arguments ?? {});
    } catch {
      // Keep malformed tool arguments as an empty preview payload; execution still uses raw args.
    }

    // OTel execute_tool span. Created up-front so it survives every exit path
    // (client-tool pause / success / error), ended in finally.
    const toolSource =
      state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
      state.toolSourceMap?.[chatToolPayload.identifier];
    const executeToolSpan = agentRuntimeTracer.startSpan(executeToolSpanName(toolName), {
      attributes: buildExecuteToolAttributes({
        operationId,
        stepIndex,
        toolCallId: chatToolPayload.id,
        toolName,
        toolSource,
        toolType: GEN_AI_FUNCTION_TOOL_TYPE,
      }),
    });

    try {
      try {
        if (toolSource === 'client') {
          log(`[${operationLogId}] Client function tool detected: ${toolName}, pausing for client`);

          // Publish tool call info so streaming can emit function_call events
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'tools_calling',
            toolsCalling: [chatToolPayload] as any,
          });

          const newState = structuredClone(state);
          newState.lastModified = new Date().toISOString();
          newState.status = 'waiting_for_async_tool';
          newState.interruption = {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            interruptedInstruction: instruction,
            reason: 'client_tool_execution',
          };
          newState.pendingToolsCalling = [chatToolPayload];

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
            // No nextContext — loop stops, waiting for client to provide tool result
          };
        }

        // Extract toolResultMaxLength from agent config
        const agentConfig = state.metadata?.agentConfig;
        const toolResultMaxLength = agentConfig?.chatConfig?.toolResultMaxLength;

        // Build effective manifest map (operation + step-level activations)
        const effectiveManifestMap = {
          ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
          ...Object.fromEntries(
            (state.activatedStepTools ?? [])
              .filter((a) => a.manifest)
              .map((a) => [a.id, a.manifest!]),
          ),
        };

        // Route to client via Agent Gateway WS when the tool is marked
        // executor='client' and the current stream manager can reach a gateway.
        // Falls through to the normal server path if either is unavailable.
        const canDispatchToClient =
          chatToolPayload.executor === 'client' &&
          typeof streamManager.sendToolExecute === 'function';

        let toolCallMocked = false;
        const hookResult = ctx.hookDispatcher
          ? await (async () => {
              // 1. dispatch for observation (webhook in production, local handler logging)
              ctx
                .hookDispatcher!.dispatch(
                  operationId,
                  'beforeToolCall',
                  {
                    apiName: chatToolPayload.apiName,
                    args: parsedArgs,
                    callIndex,
                    identifier: chatToolPayload.identifier,
                    operationId,
                    stepIndex,
                    userId: ctx.userId,
                  },
                  state.metadata?._hooks,
                )
                .catch(() => {});
              // 2. dispatchBeforeToolCall for mock support (local-only)
              return ctx.hookDispatcher!.dispatchBeforeToolCall(operationId, {
                apiName: chatToolPayload.apiName,
                args: parsedArgs,
                callIndex,
                identifier: chatToolPayload.identifier,
                stepIndex,
              });
            })()
          : null;

        let execution: { result: ToolExecutionResultResponse; attempts: number };
        if (isDeviceToolIdentifier(chatToolPayload.identifier) && !hookResult?.isMocked) {
          // Per-call audit for device tools (local-system / remote-device).
          // Emitted before dispatch so the record exists even if dispatch
          // throws. We rely on the engine's enable gate to keep `canUseDevice`
          // true here; recording the policy reason inline lets an operator
          // distinguish first-party vs bot-owner runs without joining logs.
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

        if (hookResult?.isMocked) {
          log(`[${operationLogId}] Tool ${toolName} mocked by beforeToolCall hook`);
          toolCallMocked = true;
          execution = {
            attempts: 0,
            result: { content: hookResult.content, executionTime: 0, success: true },
          };
        } else if (canDispatchToClient) {
          log(`[${operationLogId}] Dispatching tool ${toolName} to client via Agent Gateway`);
          const timeoutMs = resolveToolTimeoutMs({
            apiName: chatToolPayload.apiName,
            args: parsedArgs,
            manifest: effectiveManifestMap[chatToolPayload.identifier],
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
          if (toolSource && !chatToolPayload.source) {
            chatToolPayload.source = toolSource;
          }

          const timeoutMs = resolveToolTimeoutMs({
            apiName: chatToolPayload.apiName,
            args: parsedArgs,
            manifest: effectiveManifestMap[chatToolPayload.identifier],
          });
          // Resolve caller-agent visibility once so tool runtimes can inherit
          // it onto side-effects (private-agent output → private docs) and gate
          // reads (public agent must not touch caller's private docs). Mirrors
          // the task side's `assertAgentVisibilityCompat` invariant.
          const toolCallAgentId = state.metadata?.agentId;
          const toolCallWorkspaceId = state.metadata?.workspaceId ?? ctx.workspaceId;
          let agentVisibility: 'private' | 'public' | null = null;
          if (toolCallAgentId && ctx.serverDB && ctx.userId) {
            try {
              const agentModel = new AgentModel(ctx.serverDB, ctx.userId, toolCallWorkspaceId);
              agentVisibility = await agentModel.getAgentVisibility(toolCallAgentId);
            } catch (error) {
              // Non-fatal: if we can't resolve visibility, fall back to null so
              // downstream defaults kick in (existing schema fallback for
              // writes; unchanged ownership for reads).
              log(`[${operationLogId}] Failed to resolve agent visibility: %O`, error);
            }
          }

          // Execute tool using ToolExecutionService
          log(`[${operationLogId}] Executing tool ${toolName} ...`);
          execution = await executeToolWithRetry(
            () =>
              toolExecutionService.executeTool(chatToolPayload, {
                activeDeviceId: state.metadata?.activeDeviceId,
                agentId: toolCallAgentId,
                agentMember: buildServerAgentMemberRunner(
                  ctx,
                  state,
                  chatToolPayload,
                  payload.parentMessageId,
                ),
                agentVisibility,
                // Assistant message owning this tool call (≠ source user message).
                assistantMessageId: payload.parentMessageId,
                documentId: state.metadata?.documentId,
                editingAgentId: state.metadata?.editingAgentId,
                execSubAgent: ctx.execSubAgent,
                executionTimeoutMs: timeoutMs,
                groupId: state.metadata?.groupId,
                isSubAgent: state.metadata?.isSubAgent === true,
                memoryToolPermission: agentConfig?.chatConfig?.memory?.toolPermission,
                messageId: state.metadata?.sourceMessageId,
                operationId,
                projectSkills: (state.metadata?.operationSkillSet?.skills ?? [])
                  .filter(
                    (skill: { location?: string; source?: string }) =>
                      skill.source === 'project' && !!skill.location,
                  )
                  .map((skill: { location: string; name: string }) => ({
                    location: skill.location,
                    name: skill.name,
                  })),
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
                toolManifestMap: effectiveManifestMap,
                toolResultMaxLength,
                topicId: ctx.topicId,
                userId: ctx.userId,
                // Device-bound cwd folded into deviceSystemInfo at operation
                // creation; resume-safe via computeDeviceContext (recovers it
                // from the prior tool message's pluginState.metadata).
                workingDirectory: state.metadata?.deviceSystemInfo?.workingDirectory,
                workspaceId: toolCallWorkspaceId,
              }),
            {
              isInterrupted: () => isOperationInterrupted(ctx),
              maxRetries: TOOL_MAX_RETRIES,
              operationLogId,
              toolName,
            },
          );
        }

        // Deferred tool (e.g. async sub-agent): the executor performed its
        // side-effect and created a pending placeholder; the real result is
        // delivered out-of-band later by a completion bridge. Park like a
        // client tool — surface the pending call, hold it in pendingToolsCalling,
        // and do not write a tool_result now.
        if (execution.result.deferred) {
          log(`[${operationLogId}] Tool ${toolName} deferred; parking for async result`);
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'tools_calling',
            toolsCalling: [chatToolPayload] as any,
          });
          executeToolSpan.setAttributes(
            buildExecuteToolResultAttributes({ attempts: execution.attempts, success: true }),
          );
          const newState = structuredClone(state);
          newState.lastModified = new Date().toISOString();
          newState.status = 'waiting_for_async_tool';
          newState.interruption = {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: 'async_tool',
          };
          newState.pendingToolsCalling = [chatToolPayload];
          return {
            events: [
              {
                canResume: true,
                interruptedAt: new Date().toISOString(),
                reason: 'async_tool',
                type: 'interrupted',
              },
            ],
            newState,
          };
        }

        const executionResult = await archiveRuntimeToolResult(execution.result, {
          agentId: state.metadata?.agentId,
          identifier: chatToolPayload.identifier,
          limit: toolResultMaxLength,
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
                args: parsedArgs,
                callIndex,
                content: executionResult.content,
                executionTimeMs: executionTime,
                identifier: chatToolPayload.identifier,
                mocked: toolCallMocked,
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
          `[${operationLogId}] Executing ${toolName} in ${executionTime}ms, result: %O`,
          executionResult,
        );

        // Publish tool execution result event
        await streamManager.publishStreamEvent(operationId, {
          data: {
            executionTime,
            isSuccess,
            attempts: execution.attempts,
            maxAttempts: TOOL_MAX_RETRIES + 1,
            payload,
            phase: 'tool_execution',
            result: executionResult,
          },
          stepIndex,
          type: 'tool_end',
        });

        // Finally persist to database. In resumption mode (skipCreateToolMessage),
        // the pending tool message already exists from request_human_approve, so
        // we update it in-place rather than inserting a new row — inserting would
        // either duplicate the tool_call_id or violate parent_id FK ().
        let toolMessageId: string | undefined;
        try {
          if (payload.skipCreateToolMessage) {
            toolMessageId = payload.parentMessageId;
            await ctx.messageModel.updateToolMessage(toolMessageId, {
              content: executionResult.content,
              metadata: { toolExecutionTimeMs: executionTime },
              pluginError: executionResult.error,
              pluginState: executionResult.state,
            });
            log(
              '[%s:%d] Updated existing tool message %s (skipCreateToolMessage)',
              operationId,
              stepIndex,
              toolMessageId,
            );
          } else {
            const toolMessage = await ctx.messageModel.create({
              agentId: state.metadata!.agentId!,
              content: executionResult.content,
              groupId: state.metadata?.groupId ?? undefined,
              metadata: { toolExecutionTimeMs: executionTime },
              parentId: payload.parentMessageId,
              plugin: chatToolPayload as any,
              pluginError: executionResult.error,
              pluginState: executionResult.state,
              role: 'tool',
              threadId: state.metadata?.threadId,
              tool_call_id: chatToolPayload.id,
              topicId: state.metadata?.topicId,
            });
            toolMessageId = toolMessage.id;
          }
        } catch (error) {
          console.error('[StreamingToolExecutor] Failed to persist tool message: %O', error);
          // Normalize BEFORE publishing so clients (which treat `error` stream
          // events as terminal and surface `event.data.error` directly) see the
          // typed business error, not the raw SQL / driver text.
          const fatal = isMidOperationReferenceMissingError(error)
            ? createConversationParentMissingError(payload.parentMessageId, error)
            : error instanceof Error
              ? error
              : new Error(String(error));
          await streamManager.publishStreamEvent(operationId, {
            data: formatErrorEventData(fatal, 'tool_message_persist'),
            stepIndex,
            type: 'error',
          });
          // Mark so the outer catch (which normally converts tool-exec errors
          // into event records and returns the unchanged state) re-throws.
          throw markPersistFatal(fatal);
        }

        const newState = structuredClone(state);

        newState.messages.push({
          content: executionResult.content,
          role: 'tool',
          tool_call_id: chatToolPayload.id,
        });

        events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

        // Get tool unit price
        const toolCost = TOOL_PRICING[toolName] || 0;

        // Use UsageCounter to uniformly accumulate tool usage
        const { usage, cost } = UsageCounter.accumulateTool({
          cost: newState.cost,
          executionTime,
          success: isSuccess,
          toolCost,
          toolName,
          usage: newState.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;

        // Persist ToolsActivator discovery results to state.activatedStepTools
        const discoveredTools = executionResult.state?.activatedTools as
          Array<{ identifier: string }> | undefined;
        if (discoveredTools?.length) {
          const existingIds = new Set(
            (newState.activatedStepTools ?? []).map((t: { id: string }) => t.id),
          );
          const newActivations = discoveredTools
            .filter((t) => !existingIds.has(t.identifier))
            .map((t) => ({
              activatedAtStep: state.stepCount,
              id: t.identifier,
              manifest: effectiveManifestMap[t.identifier],
              source: 'discovery' as const,
            }));

          if (newActivations.length > 0) {
            newState.activatedStepTools = [
              ...(newState.activatedStepTools ?? []),
              ...newActivations,
            ];

            log(
              `[${operationLogId}] Persisted %d tool activations to state: %o`,
              newActivations.length,
              newActivations.map((a) => a.id),
            );
          }
        }

        // Find current tool statistics
        const currentToolStats = usage.tools.byTool.find((t) => t.name === toolName);

        // Log usage information
        log(
          `[${operationLogId}][tool usage] %s: calls=%d, time=%dms, success=%s, cost=$%s`,
          toolName,
          currentToolStats?.calls || 0,
          executionTime,
          isSuccess,
          toolCost.toFixed(4),
        );

        log('[%s:%d] Tool execution completed', operationId, stepIndex);

        // When a legacy callAgent task result carries execSubAgent / execSubAgents
        // state, the GeneralChatAgent needs `stop: true` in the payload to detect
        // it and emit the matching exec_sub_agent / exec_sub_agents instruction.
        // Without this flag the agent falls through to the normal LLM-call path
        // and the background agent run is never spawned.
        const legacyAgentInvocationStateType = executionResult.state?.type as string | undefined;
        const isLegacyAgentInvocationState =
          legacyAgentInvocationStateType === 'execSubAgent' ||
          legacyAgentInvocationStateType === 'execSubAgents';

        executeToolSpan.setAttributes(
          buildExecuteToolResultAttributes({ attempts: execution.attempts, success: isSuccess }),
        );

        return {
          events,
          newState,
          nextContext: {
            payload: {
              data: executionResult,
              executionTime,
              isSuccess,
              // Pass tool message ID as parentMessageId for the next LLM call
              parentMessageId: toolMessageId,
              ...(isLegacyAgentInvocationState && { stop: true }),
              toolCall: chatToolPayload,
              toolCallId: chatToolPayload.id,
            },
            phase: 'tool_result',
            session: {
              eventCount: events.length,
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
            stepUsage: {
              cost: toolCost,
              toolName,
              unitPrice: toolCost,
              usageCount: 1,
            },
          },
        };
      } catch (error) {
        executeToolSpan.recordException(error as Error);
        executeToolSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        executeToolSpan.setAttributes(buildExecuteToolResultAttributes({ success: false }));

        // Persist-level failures (parent FK violation etc.) must propagate so
        // the step fails — otherwise the swallow-and-continue path keeps
        // running the agent on a broken conversation chain. See .
        if (isPersistFatal(error)) throw error;

        if (ctx.hookDispatcher) {
          ctx.hookDispatcher
            .dispatch(
              operationId,
              'onToolCallError',
              {
                apiName: chatToolPayload.apiName,
                args: parsedArgs,
                callIndex,
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

        // Publish tool execution error event
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(error, 'tool_execution'),
          stepIndex,
          type: 'error',
        });

        events.push({ error, type: 'error' });

        console.error(
          `[StreamingToolExecutor] Tool execution failed for operation ${operationId}:${stepIndex}:`,
          error,
        );

        return {
          events,
          newState: state, // State unchanged
        };
      }
    } finally {
      executeToolSpan.end();
    }
  };
