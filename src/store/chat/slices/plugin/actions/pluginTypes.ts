/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { type ChatToolPayload, type RuntimeStepContext } from '@lobechat/types';
import { PluginErrorType } from '@lobehub/chat-plugin-sdk';
import debug from 'debug';
import { t } from 'i18next';

import { type MCPToolCallResult } from '@/libs/mcp';
import { truncateToolResult } from '@/server/utils/truncateToolResult';
import { chatService } from '@/services/chat';
import { mcpService } from '@/services/mcp';
import { messageService } from '@/services/message';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation';
import { type ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import { hasExecutor } from '@/store/tool/slices/builtin/executors';
import { type StoreSetter } from '@/store/types';
import { safeParseJSON } from '@/utils/safeParseJSON';

import { dbMessageSelectors } from '../../message/selectors';
import { type RemoteToolExecutor } from './exector';
import { klavisExecutor, lobehubSkillExecutor } from './exector';

const log = debug('lobe-store:plugin-types');

/**
 * Plugin type-specific implementations
 * Each method handles a specific type of plugin invocation
 */

type Setter = StoreSetter<ChatStore>;
export const pluginTypes = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginTypesActionImpl(set, get, _api);

export class PluginTypesActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  invokeBuiltinTool = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ): Promise<any> => {
    // Check if this is a Klavis tool by source field
    if (payload.source === 'klavis') {
      return await this.#get().invokeKlavisTypePlugin(id, payload);
    }

    // Check if this is a LobeHub Skill tool by source field
    if (payload.source === 'lobehubSkill') {
      return await this.#get().invokeLobehubSkillTypePlugin(id, payload);
    }

    const params = safeParseJSON(payload.arguments);
    if (!params) return { error: 'Invalid arguments', success: false };

    // Check if there's a registered executor in Tool Store (new architecture)
    if (hasExecutor(payload.identifier, payload.apiName)) {
      const { optimisticUpdateToolMessage, registerAfterCompletionCallback } = this.#get();

      // Get operation context
      const operationId = this.#get().messageOperationMap[id];
      const operation = operationId ? this.#get().operations[operationId] : undefined;
      const context = operationId ? { operationId } : undefined;

      // Get agent ID, group ID, and topic ID from operation context
      let agentId = operation?.context?.agentId;
      let groupId = operation?.context?.groupId;
      const topicId = operation?.context?.topicId;

      // For agent-builder tools, inject activeAgentId from store if not in context
      // This is needed because AgentBuilderProvider uses a separate scope for messages
      // but the tools need the correct agentId for execution
      if (payload.identifier === 'lobe-agent-builder') {
        const activeAgentId = this.#get().activeAgentId;
        if (activeAgentId) {
          agentId = activeAgentId;
        }
      }

      // For group-agent-builder tools, inject activeGroupId from store if not in context
      // This is needed because AgentBuilderProvider uses a separate scope for messages
      // but still needs groupId for tool execution
      if (!groupId && payload.identifier === 'lobe-group-agent-builder') {
        const { getChatGroupStoreState } = await import('@/store/agentGroup');
        groupId = getChatGroupStoreState().activeGroupId;
      }

      // Get group orchestration callbacks if available (for group management tools)
      const groupOrchestration = this.#get().getGroupOrchestrationCallbacks?.();

      // Find root execAgentRuntime operation for registering afterCompletion callbacks
      // Navigate up the operation tree to find the root runtime operation
      let rootRuntimeOperationId: string | undefined;
      if (operationId) {
        let currentOp = operation;
        while (currentOp) {
          if (AI_RUNTIME_OPERATION_TYPES.includes(currentOp.type)) {
            rootRuntimeOperationId = currentOp.id;
            break;
          }
          // Move up to parent operation
          const parentId = currentOp.parentOperationId;
          currentOp = parentId ? this.#get().operations[parentId] : undefined;
        }
      }

      // Create registerAfterCompletion function that registers callback to root runtime operation
      const registerAfterCompletion = rootRuntimeOperationId
        ? (callback: Parameters<typeof registerAfterCompletionCallback>[1]) => {
            registerAfterCompletionCallback(rootRuntimeOperationId!, callback);
          }
        : undefined;

      log(
        '[invokeBuiltinTool] Using Tool Store executor: %s/%s, messageId=%s, agentId=%s, groupId=%s, hasGroupOrchestration=%s, rootRuntimeOp=%s, stepContext=%O',
        payload.identifier,
        payload.apiName,
        id,
        agentId,
        groupId,
        !!groupOrchestration,
        rootRuntimeOperationId,
        !!stepContext,
      );

      // Call Tool Store's invokeBuiltinTool
      const result = await useToolStore
        .getState()
        .invokeBuiltinTool(payload.identifier, payload.apiName, params, {
          agentId,
          groupId,
          groupOrchestration,
          messageId: id,
          operationId,
          registerAfterCompletion,
          signal: operation?.abortController?.signal,
          stepContext,
          topicId,
        });

      // Use optimisticUpdateToolMessage to batch update content, state, error, metadata
      await optimisticUpdateToolMessage(
        id,
        {
          content: result.content,
          metadata: result.metadata,
          pluginError: result.error
            ? {
                body: result.error.body,
                message: result.error.message,
                type: result.error.type as any,
              }
            : undefined,
          pluginState: result.state,
        },
        context,
      );

      // If result.stop is true, the tool wants to stop execution flow
      // This is handled by returning from the function (no further processing)
      if (result.stop) {
        log('[invokeBuiltinTool] Executor returned stop=true, stopping execution');
      }

      // Return the result for call_tool executor to use
      return result;
    }

    // All builtin tools should be handled by the executor registry above
    // If we reach here, it means the tool is not registered
    console.error(
      `[invokeBuiltinTool] No executor found for: ${payload.identifier}/${payload.apiName}`,
    );
    return;
  };

  invokeDefaultTypePlugin = async (id: string, payload: any): Promise<string | undefined> => {
    const { internal_callPluginApi } = this.#get();

    const data = await internal_callPluginApi(id, payload);

    if (!data) return;

    return data;
  };

  invokeKlavisTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    return this.#get().internal_invokeRemoteToolPlugin(
      id,
      payload,
      klavisExecutor,
      'invokeKlavisTypePlugin',
    );
  };

  invokeLobehubSkillTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    return this.#get().internal_invokeRemoteToolPlugin(
      id,
      payload,
      lobehubSkillExecutor,
      'invokeLobehubSkillTypePlugin',
    );
  };

  invokeMarkdownTypePlugin = async (id: string, payload: ChatToolPayload): Promise<void> => {
    const { internal_callPluginApi } = this.#get();

    await internal_callPluginApi(id, payload);
  };

  invokeStandaloneTypePlugin = async (id: string, payload: ChatToolPayload): Promise<void> => {
    const result = await useToolStore.getState().validatePluginSettings(payload.identifier);
    if (!result) return;

    // if the plugin settings is not valid, then set the message with error type
    if (!result.valid) {
      // Get message to extract agentId/topicId
      const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
      const updateResult = await messageService.updateMessageError(
        id,
        {
          body: {
            error: result.errors,
            message: '[plugin] your settings is invalid with plugin manifest setting schema',
          },
          message: t('response.PluginSettingsInvalid', { ns: 'error' }),
          type: PluginErrorType.PluginSettingsInvalid as any,
        },
        {
          agentId: message?.agentId,
          topicId: message?.topicId,
        },
      );

      if (updateResult?.success && updateResult.messages) {
        this.#get().replaceMessages(updateResult.messages, {
          context: { agentId: message?.agentId || '', topicId: message?.topicId },
        });
      }
      return;
    }
  };

  invokeMCPTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    let data: MCPToolCallResult | undefined;

    // Get message to extract agentId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[invokeMCPTypePlugin] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    try {
      const result = await mcpService.invokeMcpToolCall(payload, {
        signal: abortController?.signal,
        topicId: message?.topicId,
      });

      if (!!result) data = result;
    } catch (error) {
      console.error(error);
      const err = error as Error;

      // ignore the aborted request error
      if (err.message.includes('The user aborted a request.')) {
        log('[invokeMCPTypePlugin] Request aborted: messageId=%s, tool=%s', id, payload.apiName);
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          this.#get().replaceMessages(result.messages, {
            context: { agentId: message?.agentId || '', topicId: message?.topicId },
          });
        }
      }
    }

    // 如果报错则结束了

    if (!data) return;

    // Truncate content to prevent context overflow
    const truncatedContent = truncateToolResult(data.content);

    // operationId already declared above, reuse it
    const context = operationId ? { operationId } : undefined;

    // Use optimisticUpdateToolMessage to update content and state/error in a single call
    await this.#get().optimisticUpdateToolMessage(
      id,
      {
        content: truncatedContent,
        pluginError: data.success ? undefined : data.error,
        pluginState: data.success ? data.state : undefined,
      },
      context,
    );

    return truncatedContent;
  };

  internal_invokeRemoteToolPlugin = async (
    id: string,
    payload: ChatToolPayload,
    executor: RemoteToolExecutor,
    logPrefix: string,
  ): Promise<string | undefined> => {
    let data: MCPToolCallResult | undefined;

    // Get message to extract sessionId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[%s] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      logPrefix,
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    try {
      data = await executor(payload);
    } catch (error) {
      console.error(`[${logPrefix}] Error:`, error);

      // ignore the aborted request error
      const err = error as Error;
      if (err.message.includes('aborted')) {
        log('[%s] Request aborted: messageId=%s, tool=%s', logPrefix, id, payload.apiName);
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          this.#get().replaceMessages(result.messages, {
            context: {
              agentId: message?.agentId,
              topicId: message?.topicId,
            },
          });
        }
      }
    }

    // If error occurred, exit
    if (!data) return;

    const context = operationId ? { operationId } : undefined;

    // Use optimisticUpdateToolMessage to update content and state/error in a single call
    await this.#get().optimisticUpdateToolMessage(
      id,
      {
        content: data.content,
        pluginError: data.success ? undefined : data.error,
        pluginState: data.success ? data.state : undefined,
      },
      context,
    );

    return data.content;
  };

  internal_callPluginApi = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    const { optimisticUpdateMessageContent } = this.#get();
    let data: string;

    // Get message to extract agentId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[internal_callPluginApi] messageId=%s, plugin=%s, operationId=%s, aborted=%s',
      id,
      payload.identifier,
      operationId,
      abortController?.signal.aborted,
    );

    try {
      const res = await chatService.runPluginApi(payload, {
        signal: abortController?.signal,
        trace: { observationId: message?.observationId, traceId: message?.traceId },
      });
      data = res.text;

      // save traceId
      if (res.traceId) {
        await messageService.updateMessage(id, { traceId: res.traceId });
      }
    } catch (error) {
      console.error(error);
      const err = error as Error;

      // ignore the aborted request error
      if (err.message.includes('The user aborted a request.')) {
        log(
          '[internal_callPluginApi] Request aborted: messageId=%s, plugin=%s',
          id,
          payload.identifier,
        );
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          this.#get().replaceMessages(result.messages, {
            context: { agentId: message?.agentId || '', topicId: message?.topicId },
          });
        }
      }

      data = '';
    }
    // 如果报错则结束了
    if (!data) return;

    // operationId already declared above, reuse it
    const context = operationId ? { operationId } : undefined;

    await optimisticUpdateMessageContent(id, data, undefined, context);

    return data;
  };
}

export type PluginTypesAction = Pick<PluginTypesActionImpl, keyof PluginTypesActionImpl>;
