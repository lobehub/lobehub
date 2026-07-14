import type {
  ToolRunContext,
  ToolRunExecution,
  ToolRunResult,
  ToolTransport,
} from '@lobechat/agent-runtime';
import type { ChatToolPayload, CreateMessageParams } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

import type { ClientMessageTransport } from './ClientMessageTransport';

const TOOL_PRICING: Record<string, number> = {
  'lobe-web-browsing/craw': 0.002,
  'lobe-web-browsing/search': 0.001,
};

const CANCELLED_CONTENT = 'Tool execution was cancelled by user.';

/** Client tool adapter backed by optimistic messages and local tool executors. */
export class ClientToolTransport implements ToolTransport {
  canRunClientTools = true;
  maxRetries = 0;

  constructor(
    private readonly get: () => ChatStore,
    private readonly messageKey: string,
    private readonly operationId: string,
    private readonly messages: ClientMessageTransport,
  ) {}

  getCost(toolName: string) {
    return TOOL_PRICING[toolName] ?? 0;
  }

  async run(call: ChatToolPayload, context: ToolRunContext): Promise<ToolRunExecution> {
    const store = this.get();
    const rootOperation = store.operations[this.operationId];
    if (!rootOperation) throw new Error(`Operation not found: ${this.operationId}`);

    const opContext = rootOperation.context;
    const messages = store.dbMessagesMap[this.messageKey] ?? [];
    const existingToolMessage = context.reuseExistingMessage
      ? messages.find((message) => message.id === context.parentMessageId)
      : undefined;
    const assistantMessage =
      messages.find(
        (message) => message.id === context.parentMessageId && message.role === 'assistant',
      ) ??
      (existingToolMessage?.parentId
        ? messages.find(
            (message) =>
              message.id === existingToolMessage.parentId && message.role === 'assistant',
          )
        : undefined) ??
      (opContext.messageId
        ? messages.find(
            (message) => message.id === opContext.messageId && message.role === 'assistant',
          )
        : undefined) ??
      messages.findLast((message) => message.role === 'assistant');
    const sourceMessageId =
      opContext.sourceMessageId ??
      assistantMessage?.parentId ??
      (opContext.messageId !== assistantMessage?.id ? opContext.messageId : undefined);
    const effectiveAgentId =
      opContext.subAgentId && opContext.scope !== 'sub_agent'
        ? opContext.subAgentId
        : opContext.agentId;

    const { operationId: toolOperationId } = store.startOperation({
      context: {
        agentId: opContext.agentId!,
        groupId: opContext.groupId,
        scope: opContext.scope,
        sourceMessageId,
        threadId: opContext.threadId,
        topicId: opContext.topicId,
        viewedTask: opContext.viewedTask,
      },
      metadata: {
        apiName: call.apiName,
        identifier: call.identifier,
        startTime: Date.now(),
        tool_call_id: call.id,
      },
      parentOperationId: this.operationId,
      type: 'toolCalling',
    });

    try {
      const toolMessageId = context.reuseExistingMessage
        ? context.parentMessageId
        : await this.createToolMessage({
            assistantGroupId: assistantMessage?.groupId ?? undefined,
            call,
            effectiveAgentId,
            parentMessageId: context.parentMessageId,
            toolOperationId,
          });

      if (store.operations[toolOperationId]?.abortController.signal.aborted) {
        return this.createInterruptedExecution(toolMessageId);
      }

      const { operationId: executeOperationId } = store.startOperation({
        context: { messageId: toolMessageId },
        metadata: { startTime: Date.now(), tool_call_id: call.id },
        parentOperationId: toolOperationId,
        type: 'executeToolCall',
      });

      store.onOperationCancel(executeOperationId, async () => {
        await this.markMessageCancelled(toolMessageId, executeOperationId);
      });

      const startedAt = performance.now();
      const rawResult = await store.internal_invokeDifferentTypePlugin(
        toolMessageId,
        call,
        context.stepContext,
      );

      if (store.operations[executeOperationId]?.abortController.signal.aborted) {
        return this.createInterruptedExecution(toolMessageId);
      }

      store.completeOperation(executeOperationId);

      const executionTime = Math.round(performance.now() - startedAt);
      const result = this.normalizeResult(rawResult, context.toolName, executionTime);

      if (result.success) {
        store.completeOperation(toolOperationId);
      } else {
        store.failOperation(toolOperationId, {
          message: this.errorMessage(result.error),
          type: 'ToolExecutionError',
        });
      }

      return {
        attempts: 1,
        result,
        resultPersisted: rawResult !== undefined && rawResult !== null,
        toolMessageId,
      };
    } catch (error) {
      store.failOperation(toolOperationId, {
        message: this.errorMessage(error),
        type: 'ToolExecutionError',
      });
      throw error;
    }
  }

  private async createToolMessage(input: {
    assistantGroupId?: string;
    call: ChatToolPayload;
    effectiveAgentId?: string | null;
    parentMessageId: string;
    toolOperationId: string;
  }): Promise<string> {
    const store = this.get();
    const rootContext = store.operations[this.operationId]!.context;
    const { operationId: createOperationId } = store.startOperation({
      context: {
        agentId: rootContext.agentId!,
        threadId: rootContext.threadId,
        topicId: rootContext.topicId,
      },
      metadata: { startTime: Date.now(), tool_call_id: input.call.id },
      parentOperationId: input.toolOperationId,
      type: 'createToolMessage',
    });

    store.onOperationCancel(createOperationId, async ({ metadata }) => {
      const createResult = await metadata?.createMessagePromise;
      if (createResult) await this.markMessageCancelled(createResult.id, createOperationId);
    });

    const params: CreateMessageParams = {
      agentId: input.effectiveAgentId!,
      content: '',
      groupId: input.assistantGroupId,
      parentId: input.parentMessageId,
      plugin: input.call,
      role: 'tool',
      threadId: rootContext.threadId,
      tool_call_id: input.call.id,
      topicId: rootContext.topicId ?? undefined,
    };
    const createPromise = this.messages.createToolMessageForOperation(params, createOperationId);
    store.updateOperationMetadata(createOperationId, { createMessagePromise: createPromise });

    let createResult: Awaited<typeof createPromise>;
    try {
      createResult = await createPromise;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Failed to create tool message for tool_call_id: ${input.call.id}`;
      store.failOperation(createOperationId, { message, type: 'CreateMessageError' });
      throw error;
    }

    store.completeOperation(createOperationId);
    return createResult.id;
  }

  private createInterruptedExecution(toolMessageId: string): ToolRunExecution {
    return {
      attempts: 0,
      interrupted: true,
      result: { content: CANCELLED_CONTENT, success: false },
      resultPersisted: true,
      toolMessageId,
    };
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    return 'Tool execution failed';
  }

  private async markMessageCancelled(messageId: string, operationId: string) {
    const store = this.get();
    await Promise.all([
      store.optimisticUpdateMessageContent(messageId, CANCELLED_CONTENT, undefined, {
        operationId,
      }),
      store.optimisticUpdateMessagePlugin(
        messageId,
        { intervention: { status: 'aborted' } },
        { operationId },
      ),
    ]);
  }

  private normalizeResult(rawResult: any, toolName: string, executionTime: number): ToolRunResult {
    if (rawResult === undefined || rawResult === null) {
      return {
        content: `Tool ${toolName} execution failed: no result returned`,
        error: { message: 'Tool returned no result', type: 'ToolExecutionError' },
        executionTime,
        success: false,
      };
    }

    return {
      ...rawResult,
      content:
        typeof rawResult.content === 'string' ? rawResult.content : JSON.stringify(rawResult),
      executionTime,
      success: typeof rawResult.success === 'boolean' ? rawResult.success : !rawResult.error,
    };
  }
}
