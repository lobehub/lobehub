import type { ToolRunContext, ToolRunExecution, ToolTransport } from '@lobechat/agent-runtime';
import { executeToolWithRetry } from '@lobechat/agent-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildExecuteToolAttributes,
  buildExecuteToolResultAttributes,
  executeToolSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { isDeviceCapablePlan } from '@/helpers/executionTarget';
import type { DeviceAccessReason } from '@/server/services/aiAgent/deviceToolAudit';
import {
  isDeviceToolIdentifier,
  logDeviceToolAudit,
} from '@/server/services/aiAgent/deviceToolAudit';

import type { RuntimeExecutorContext } from '../context';
import { dispatchClientTool } from '../dispatchClientTool';
import {
  archiveRuntimeToolResult,
  buildServerAgentMemberRunner,
  buildServerVirtualSubAgentRunner,
  GEN_AI_FUNCTION_TOOL_TYPE,
  isOperationInterrupted,
  log,
  TOOL_MAX_RETRIES,
  TOOL_PRICING,
} from '../executorHelpers';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';
import { resolveRunProjectSkills } from '../executors/resolveRunProjectSkills';
import { resolveToolTimeoutMs } from '../resolveToolTimeout';

export class ServerToolTransport implements ToolTransport {
  maxRetries = TOOL_MAX_RETRIES;

  constructor(private readonly ctx: RuntimeExecutorContext) {}

  getCost(toolName: string) {
    return TOOL_PRICING[toolName] || 0;
  }

  async handleError(
    chatToolPayload: ChatToolPayload,
    error: unknown,
    context: ToolRunContext,
  ): Promise<void> {
    const { hookDispatcher, operationId, stepIndex, userId } = this.ctx;

    if (hookDispatcher) {
      hookDispatcher
        .dispatch(
          operationId,
          'onToolCallError',
          {
            apiName: chatToolPayload.apiName,
            args: context.parsedArgs,
            callIndex: context.callIndex,
            error: error instanceof Error ? error.message : String(error),
            identifier: chatToolPayload.identifier,
            operationId,
            stepIndex,
            userId,
          },
          context.state.metadata?._hooks,
        )
        .catch(() => {});
    }

    console.error(
      `[StreamingToolExecutor] Tool execution failed for operation ${operationId}:${stepIndex}:`,
      error,
    );
  }

  async run(chatToolPayload: ChatToolPayload, context: ToolRunContext): Promise<ToolRunExecution> {
    const { operationId, serverDB, stepIndex, streamManager, toolExecutionService, userId } =
      this.ctx;
    const operationLogId = `${operationId}:${stepIndex}`;
    const executeToolSpan = agentRuntimeTracer.startSpan(executeToolSpanName(context.toolName), {
      attributes: buildExecuteToolAttributes({
        operationId,
        stepIndex,
        toolCallId: chatToolPayload.id,
        toolName: context.toolName,
        toolSource: context.toolSource,
        toolType: GEN_AI_FUNCTION_TOOL_TYPE,
      }),
    });

    try {
      const hookResult = await this.dispatchBeforeToolCall(chatToolPayload, context);
      let toolCallMocked = false;

      if (isDeviceToolIdentifier(chatToolPayload.identifier) && !hookResult?.isMocked) {
        const policy = context.state.metadata?.deviceAccessPolicy as
          { canUseDevice: boolean; reason: DeviceAccessReason } | undefined;
        logDeviceToolAudit({
          apiName: chatToolPayload.apiName,
          botContext: context.state.metadata?.botContext,
          canUseDevice: policy?.canUseDevice ?? true,
          messageId: context.state.metadata?.sourceMessageId,
          operationId,
          reason: policy?.reason ?? 'first-party',
          toolIdentifier: chatToolPayload.identifier,
          topicId: this.ctx.topicId,
          userId,
        });
      }

      let execution: ToolRunExecution;
      if (hookResult?.isMocked) {
        log(`[${operationLogId}] Tool ${context.toolName} mocked by beforeToolCall hook`);
        toolCallMocked = true;
        execution = {
          attempts: 0,
          mocked: true,
          result: { content: hookResult.content, executionTime: 0, success: true },
        };
      } else if (
        chatToolPayload.executor === 'client' &&
        typeof streamManager.sendToolExecute === 'function'
      ) {
        log(`[${operationLogId}] Dispatching tool ${context.toolName} to client via Agent Gateway`);
        const timeoutMs = resolveToolTimeoutMs({
          apiName: chatToolPayload.apiName,
          args: context.parsedArgs,
          manifest: context.effectiveManifestMap[chatToolPayload.identifier],
        });
        const dispatchResult = await dispatchClientTool(chatToolPayload, {
          operationId,
          streamManager,
          timeoutMs,
        });
        execution = { attempts: 1, result: dispatchResult };
      } else {
        if (context.toolSource && !chatToolPayload.source) {
          chatToolPayload.source = context.toolSource as any;
        }

        const timeoutMs = resolveToolTimeoutMs({
          apiName: chatToolPayload.apiName,
          args: context.parsedArgs,
          manifest: context.effectiveManifestMap[chatToolPayload.identifier],
        });
        const agentVisibility = await this.resolveAgentVisibility(context);

        log(`[${operationLogId}] Executing tool ${context.toolName} ...`);
        execution = await executeToolWithRetry(
          () =>
            toolExecutionService.executeTool(chatToolPayload, {
              activatedSkills: context.activatedSkills as any,
              activeDeviceId: resolveRunActiveDeviceId(context.state.metadata),
              agentId: context.state.metadata?.agentId,
              agentMember: buildServerAgentMemberRunner(
                this.ctx,
                context.state,
                chatToolPayload,
                context.parentMessageId,
              ),
              ...(agentVisibility !== undefined && { agentVisibility }),
              assistantMessageId: context.parentMessageId,
              deviceCapable: context.state.metadata?.executionPlan
                ? isDeviceCapablePlan(context.state.metadata.executionPlan)
                : undefined,
              documentId: context.state.metadata?.documentId,
              editingAgentId: context.state.metadata?.editingAgentId,
              execSubAgent: this.ctx.execSubAgent,
              executionTimeoutMs: timeoutMs,
              groupId: context.state.metadata?.groupId,
              isSubAgent: context.state.metadata?.isSubAgent === true,
              memoryToolPermission:
                context.state.metadata?.agentConfig?.chatConfig?.memory?.toolPermission,
              messageId: context.state.metadata?.sourceMessageId,
              operationId,
              projectSkills: resolveRunProjectSkills(context.state.metadata),
              scope: context.state.metadata?.scope,
              serverDB,
              skipResultTruncation: true,
              subAgent: buildServerVirtualSubAgentRunner(
                this.ctx,
                context.state,
                chatToolPayload,
                context.parentMessageId,
              ),
              taskId: context.state.metadata?.taskId,
              threadId: context.state.metadata?.threadId,
              toolCallId: chatToolPayload.id,
              toolManifestMap: context.effectiveManifestMap,
              toolResultMaxLength: context.toolResultMaxLength,
              topicId: this.ctx.topicId,
              userId,
              workingDirectory: context.state.metadata?.deviceSystemInfo?.workingDirectory,
              workspaceId: context.state.metadata?.workspaceId ?? this.ctx.workspaceId,
            }),
          {
            isInterrupted: () => isOperationInterrupted(this.ctx),
            maxRetries: TOOL_MAX_RETRIES,
            onRetry: ({ attempt, kind, maxAttempts }) =>
              log(
                '[%s] Tool %s failed with kind=%s (attempt %d/%d), retrying ...',
                operationLogId,
                context.toolName,
                kind,
                attempt,
                maxAttempts,
              ),
          },
        );
      }

      if (execution.result.deferred) {
        executeToolSpan.setAttributes(
          buildExecuteToolResultAttributes({ attempts: execution.attempts, success: true }),
        );
        return { ...execution, mocked: toolCallMocked || execution.mocked };
      }

      const resultWithExecutionTime = {
        ...execution.result,
        executionTime: execution.result.executionTime ?? 0,
      };
      const executionResult = await archiveRuntimeToolResult(resultWithExecutionTime, {
        agentId: context.state.metadata?.agentId,
        identifier: chatToolPayload.identifier,
        limit: context.toolResultMaxLength,
        serverDB,
        toolCallId: chatToolPayload.id,
        topicId: this.ctx.topicId ?? context.state.metadata?.topicId,
        userId,
        workspaceId: context.state.metadata?.workspaceId ?? this.ctx.workspaceId,
      });

      await this.dispatchAfterToolCall(chatToolPayload, context, executionResult, toolCallMocked);

      executeToolSpan.setAttributes(
        buildExecuteToolResultAttributes({
          attempts: execution.attempts,
          success: executionResult.success,
        }),
      );

      return {
        ...execution,
        mocked: toolCallMocked || execution.mocked,
        result: executionResult,
      };
    } catch (error) {
      executeToolSpan.recordException(error as Error);
      executeToolSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      executeToolSpan.setAttributes(buildExecuteToolResultAttributes({ success: false }));
      throw error;
    } finally {
      executeToolSpan.end();
    }
  }

  private async dispatchBeforeToolCall(chatToolPayload: ChatToolPayload, context: ToolRunContext) {
    const { hookDispatcher, operationId, stepIndex, userId } = this.ctx;
    if (!hookDispatcher) return null;

    hookDispatcher
      .dispatch(
        operationId,
        'beforeToolCall',
        {
          apiName: chatToolPayload.apiName,
          args: context.parsedArgs,
          callIndex: context.callIndex,
          identifier: chatToolPayload.identifier,
          operationId,
          stepIndex,
          userId,
        },
        context.state.metadata?._hooks,
      )
      .catch(() => {});

    return hookDispatcher.dispatchBeforeToolCall(operationId, {
      apiName: chatToolPayload.apiName,
      args: context.parsedArgs,
      callIndex: context.callIndex,
      identifier: chatToolPayload.identifier,
      stepIndex,
    });
  }

  private async dispatchAfterToolCall(
    chatToolPayload: ChatToolPayload,
    context: ToolRunContext,
    result: ToolRunExecution['result'],
    mocked: boolean,
  ) {
    const { hookDispatcher, operationId, stepIndex, userId } = this.ctx;
    if (!hookDispatcher) return;

    hookDispatcher
      .dispatch(
        operationId,
        'afterToolCall',
        {
          apiName: chatToolPayload.apiName,
          args: context.parsedArgs,
          callIndex: context.callIndex,
          content: result.content,
          executionTimeMs: result.executionTime ?? 0,
          identifier: chatToolPayload.identifier,
          mocked,
          operationId,
          stepIndex,
          success: result.success,
          userId,
        },
        context.state.metadata?._hooks,
      )
      .catch(() => {});
  }

  private async resolveAgentVisibility(context: ToolRunContext) {
    if (context.mode !== 'single') return undefined;

    const agentId = context.state.metadata?.agentId;
    const workspaceId = context.state.metadata?.workspaceId ?? this.ctx.workspaceId;
    if (!agentId || !this.ctx.serverDB || !this.ctx.userId) return null;

    try {
      const agentModel = new AgentModel(this.ctx.serverDB, this.ctx.userId, workspaceId);
      return await agentModel.getAgentVisibility(agentId);
    } catch (error) {
      log(
        `[${this.ctx.operationId}:${this.ctx.stepIndex}] Failed to resolve agent visibility: %O`,
        error,
      );
      return null;
    }
  }
}
