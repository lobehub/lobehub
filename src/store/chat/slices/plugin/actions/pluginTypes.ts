/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { CloudSandboxIdentifier, type ExportFileState } from '@lobechat/builtin-tool-cloud-sandbox';
import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { type ChatToolPayload, type RuntimeStepContext } from '@lobechat/types';
import { PluginErrorType } from '@lobehub/chat-plugin-sdk';
import debug from 'debug';
import { t } from 'i18next';
import { type StateCreator } from 'zustand/vanilla';

import { type MCPToolCallResult } from '@/libs/mcp';
import { chatService } from '@/services/chat';
import { codeInterpreterService } from '@/services/codeInterpreter';
import { fileService } from '@/services/file';
import { mcpService } from '@/services/mcp';
import { messageService } from '@/services/message';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation';
import { type ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import { hasExecutor } from '@/store/tool/slices/builtin/executors';
import { safeParseJSON } from '@/utils/safeParseJSON';

import { dbMessageSelectors } from '../../message/selectors';

const log = debug('lobe-store:plugin-types');

/**
 * Get MIME type from filename extension
 */
const getMimeTypeFromFilename = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    // Images
    bmp: 'image/bmp',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    // Videos
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    // Documents
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    html: 'text/html',
    json: 'application/json',
    md: 'text/markdown',
    pdf: 'application/pdf',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    rtf: 'application/rtf',
    txt: 'text/plain',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: 'application/xml',
    // Code
    css: 'text/css',
    js: 'text/javascript',
    py: 'text/x-python',
    ts: 'text/typescript',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

/**
 * Plugin type-specific implementations
 * Each method handles a specific type of plugin invocation
 */
export interface PluginTypesAction {
  /**
   * Invoke builtin tool
   *
   * @param id - Tool message ID
   * @param payload - Tool call payload
   * @param stepContext - Optional step context with dynamic state like GTD todos
   * @returns The tool execution result (including stop flag for flow control)
   */
  invokeBuiltinTool: (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ) => Promise<any>;

  /**
   * Invoke Cloud Code Interpreter tool
   */
  invokeCloudCodeInterpreterTool: (
    id: string,
    payload: ChatToolPayload,
  ) => Promise<string | undefined>;

  /**
   * Invoke default type plugin (returns data)
   */
  invokeDefaultTypePlugin: (id: string, payload: any) => Promise<string | undefined>;

  /**
   * Invoke Klavis type plugin
   */
  invokeKlavisTypePlugin: (id: string, payload: ChatToolPayload) => Promise<string | undefined>;

  /**
   * Invoke markdown type plugin
   */
  invokeMarkdownTypePlugin: (id: string, payload: ChatToolPayload) => Promise<void>;

  /**
   * Invoke MCP type plugin
   */
  invokeMCPTypePlugin: (id: string, payload: ChatToolPayload) => Promise<string | undefined>;

  /**
   * Invoke standalone type plugin
   */
  invokeStandaloneTypePlugin: (id: string, payload: ChatToolPayload) => Promise<void>;

  /**
   * Internal method to call plugin API
   */
  internal_callPluginApi: (id: string, payload: ChatToolPayload) => Promise<string | undefined>;
}

export const pluginTypes: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  PluginTypesAction
> = (set, get) => ({
  invokeBuiltinTool: async (id, payload, stepContext) => {
    // Check if this is a Klavis tool by source field
    if (payload.source === 'klavis') {
      return await get().invokeKlavisTypePlugin(id, payload);
    }

    // Check if this is Cloud Code Interpreter - route to specific handler
    if (payload.identifier === CloudSandboxIdentifier) {
      return await get().invokeCloudCodeInterpreterTool(id, payload);
    }

    const params = safeParseJSON(payload.arguments);
    if (!params) return { error: 'Invalid arguments', success: false };

    // Check if there's a registered executor in Tool Store (new architecture)
    if (hasExecutor(payload.identifier, payload.apiName)) {
      const { optimisticUpdateToolMessage, registerAfterCompletionCallback } = get();

      // Get operation context
      const operationId = get().messageOperationMap[id];
      const operation = operationId ? get().operations[operationId] : undefined;
      const context = operationId ? { operationId } : undefined;

      // Get agent ID, group ID, and topic ID from operation context
      const agentId = operation?.context?.agentId;
      const groupId = operation?.context?.groupId;
      const topicId = operation?.context?.topicId;

      // Get group orchestration callbacks if available (for group management tools)
      const groupOrchestration = get().getGroupOrchestrationCallbacks?.();

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
          currentOp = parentId ? get().operations[parentId] : undefined;
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

    // Route GroupAgentBuilder to its dedicated action
    if (payload.identifier === GroupAgentBuilderIdentifier) {
      log('[invokeBuiltinTool] Routing to GroupAgentBuilder: %s', payload.apiName);
      return await get().internal_triggerGroupAgentBuilderToolCalling(id, payload.apiName, params);
    }

    // run tool api call (fallback for AgentBuilder and other legacy tools)
    // @ts-ignore
    const { [payload.apiName]: action } = get();
    if (!action) {
      console.error(`[invokeBuiltinTool] plugin Action not found: ${payload.apiName}`);
      return;
    }

    const content = safeParseJSON(payload.arguments);

    if (!content) return;

    return await action(id, content);
  },

  invokeCloudCodeInterpreterTool: async (id, payload) => {
    const {
      optimisticUpdateMessageContent,
      optimisticUpdatePluginState,
      optimisticUpdateMessagePluginError,
    } = get();

    // Get message to extract topicId
    const message = dbMessageSelectors.getDbMessageById(id)(get());

    // Get abort controller from operation
    const operationId = get().messageOperationMap[id];
    const operation = operationId ? get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[invokeCloudCodeInterpreterTool] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    let data: { content: string; error?: any; state?: any; success: boolean } | undefined;

    try {
      // Import ExecutionRuntime dynamically to avoid circular dependencies
      const { CloudSandboxExecutionRuntime } =
        await import('@lobechat/builtin-tool-cloud-sandbox/executionRuntime');

      // Create runtime with context
      const runtime = new CloudSandboxExecutionRuntime({
        topicId: message?.topicId || 'default',
        userId: 'current-user', // TODO: Get actual userId from auth context
      });

      // Parse arguments
      const args = safeParseJSON(payload.arguments) || {};

      // Call the appropriate method based on apiName
      const apiMethod = (runtime as Record<string, any>)[payload.apiName];
      if (!apiMethod) {
        throw new Error(`Cloud Code Interpreter API not found: ${payload.apiName}`);
      }

      data = await apiMethod.call(runtime, args);
    } catch (error) {
      console.error('[invokeCloudCodeInterpreterTool] Error:', error);

      const err = error as Error;
      if (err.message.includes('aborted') || err.message.includes('The user aborted a request.')) {
        log(
          '[invokeCloudCodeInterpreterTool] Request aborted: messageId=%s, tool=%s',
          id,
          payload.apiName,
        );
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          get().replaceMessages(result.messages, {
            context: {
              agentId: message?.agentId,
              topicId: message?.topicId,
            },
          });
        }
      }
    }

    if (!data) return;

    const context = operationId ? { operationId } : undefined;

    await Promise.all([
      optimisticUpdateMessageContent(id, data.content, undefined, context),
      (async () => {
        if (data.success && data.state) {
          await optimisticUpdatePluginState(id, data.state, context);
        } else if (!data.success && data.error) {
          await optimisticUpdateMessagePluginError(id, data.error, context);
        }
      })(),
    ]);

    // Handle exportFile: save exported file and associate with assistant message (parent)
    if (payload.apiName === 'exportFile' && data.success && data.state) {
      const exportState = data.state as ExportFileState;
      if (exportState.downloadUrl && exportState.filename) {
        try {
          // Generate a hash from the URL path (without query params) for deduplication
          // Extract the path before query params: .../code-interpreter-exports/tpc_xxx/filename.ext
          const urlPath = exportState.downloadUrl.split('?')[0];
          const hash = `ci-export-${btoa(urlPath).slice(0, 32)}`;

          // Use mimeType from state if available, otherwise infer from filename
          const mimeType = exportState.mimeType || getMimeTypeFromFilename(exportState.filename);

          // 1. Create file record in database
          const fileResult = await fileService.createFile({
            fileType: mimeType,
            hash,
            name: exportState.filename,
            size: exportState.size || 0,
            source: 'code-interpreter',
            url: exportState.downloadUrl,
          });

          // 2. If there's text content, save it to documents table for retrieval
          if (exportState.content) {
            await codeInterpreterService.saveExportedFileContent({
              content: exportState.content,
              fileId: fileResult.id,
              fileType: mimeType,
              filename: exportState.filename,
              url: exportState.downloadUrl,
            });

            log(
              '[invokeCloudCodeInterpreterTool] Saved file content to document: fileId=%s',
              fileResult.id,
            );
          }

          // 3. Associate file with the assistant message (parent of tool message)
          // The current message (id) is the tool message, we need to attach to its parent
          const targetMessageId = message?.parentId || id;

          await messageService.addFilesToMessage(targetMessageId, [fileResult.id], {
            agentId: message?.agentId,
            topicId: message?.topicId,
          });

          log(
            '[invokeCloudCodeInterpreterTool] Saved exported file: targetMessageId=%s, fileId=%s, filename=%s',
            targetMessageId,
            fileResult.id,
            exportState.filename,
          );
        } catch (error) {
          // Log error but don't fail the tool execution
          console.error('[invokeCloudCodeInterpreterTool] Failed to save exported file:', error);
        }
      }
    }

    return data.content;
  },

  invokeDefaultTypePlugin: async (id, payload) => {
    const { internal_callPluginApi } = get();

    const data = await internal_callPluginApi(id, payload);

    if (!data) return;

    return data;
  },

  invokeKlavisTypePlugin: async (id, payload) => {
    const {
      optimisticUpdateMessageContent,
      optimisticUpdatePluginState,
      optimisticUpdateMessagePluginError,
    } = get();

    let data: MCPToolCallResult | undefined;

    // Get message to extract sessionId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(get());

    // Get abort controller from operation
    const operationId = get().messageOperationMap[id];
    const operation = operationId ? get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[invokeKlavisTypePlugin] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    try {
      // payload.identifier 现在是存储用的 identifier（如 'google-calendar'）
      const identifier = payload.identifier;
      const klavisServers = useToolStore.getState().servers || [];
      const server = klavisServers.find((s) => s.identifier === identifier);

      if (!server) {
        throw new Error(`Klavis server not found: ${identifier}`);
      }

      // Parse arguments
      const args = safeParseJSON(payload.arguments) || {};

      // Call Klavis tool via store action
      const result = await useToolStore.getState().callKlavisTool({
        serverUrl: server.serverUrl,
        toolArgs: args,
        toolName: payload.apiName,
      });

      if (!result.success) {
        throw new Error(result.error || 'Klavis tool execution failed');
      }

      // result.data is MCPToolCallProcessedResult from server
      // Convert to MCPToolCallResult format
      const toolResult = result.data;
      if (toolResult) {
        data = {
          content: toolResult.content,
          error: toolResult.state?.isError ? toolResult.state : undefined,
          state: toolResult.state,
          success: toolResult.success,
        };
      }
    } catch (error) {
      console.error('[invokeKlavisTypePlugin] Error:', error);

      // ignore the aborted request error
      const err = error as Error;
      if (err.message.includes('aborted')) {
        log('[invokeKlavisTypePlugin] Request aborted: messageId=%s, tool=%s', id, payload.apiName);
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          get().replaceMessages(result.messages, {
            context: {
              agentId: message?.agentId,
              topicId: message?.topicId,
            },
          });
        }
      }
    }

    // 如果报错则结束了
    if (!data) return;

    // operationId already declared above, reuse it
    const context = operationId ? { operationId } : undefined;

    await Promise.all([
      optimisticUpdateMessageContent(id, data.content, undefined, context),
      (async () => {
        if (data.success) await optimisticUpdatePluginState(id, data.state, context);
        else await optimisticUpdateMessagePluginError(id, data.error, context);
      })(),
    ]);

    return data.content;
  },

  invokeMarkdownTypePlugin: async (id, payload) => {
    const { internal_callPluginApi } = get();

    await internal_callPluginApi(id, payload);
  },

  invokeStandaloneTypePlugin: async (id, payload) => {
    const result = await useToolStore.getState().validatePluginSettings(payload.identifier);
    if (!result) return;

    // if the plugin settings is not valid, then set the message with error type
    if (!result.valid) {
      // Get message to extract agentId/topicId
      const message = dbMessageSelectors.getDbMessageById(id)(get());
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
        get().replaceMessages(updateResult.messages, {
          context: { agentId: message?.agentId || '', topicId: message?.topicId },
        });
      }
      return;
    }
  },

  invokeMCPTypePlugin: async (id, payload) => {
    const {
      optimisticUpdateMessageContent,
      internal_constructToolsCallingContext,
      optimisticUpdatePluginState,
      optimisticUpdateMessagePluginError,
    } = get();
    let data: MCPToolCallResult | undefined;

    // Get message to extract agentId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(get());

    // Get abort controller from operation
    const operationId = get().messageOperationMap[id];
    const operation = operationId ? get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[invokeMCPTypePlugin] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    try {
      const context = internal_constructToolsCallingContext(id);
      const result = await mcpService.invokeMcpToolCall(payload, {
        signal: abortController?.signal,
        topicId: context?.topicId,
      });

      if (!!result) data = result;
    } catch (error) {
      console.log(error);
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
          get().replaceMessages(result.messages, {
            context: { agentId: message?.agentId || '', topicId: message?.topicId },
          });
        }
      }
    }

    // 如果报错则结束了

    if (!data) return;

    // operationId already declared above, reuse it
    const context = operationId ? { operationId } : undefined;

    await Promise.all([
      optimisticUpdateMessageContent(id, data.content, undefined, context),
      (async () => {
        if (data.success) await optimisticUpdatePluginState(id, data.state, context);
        else await optimisticUpdateMessagePluginError(id, data.error, context);
      })(),
    ]);

    return data.content;
  },

  internal_callPluginApi: async (id, payload) => {
    const { optimisticUpdateMessageContent } = get();
    let data: string;

    // Get message to extract agentId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(get());

    // Get abort controller from operation
    const operationId = get().messageOperationMap[id];
    const operation = operationId ? get().operations[operationId] : undefined;
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
      console.log(error);
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
          get().replaceMessages(result.messages, {
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
  },
});
