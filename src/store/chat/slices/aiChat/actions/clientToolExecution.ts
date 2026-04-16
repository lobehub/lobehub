import { type ToolExecuteData, type ToolResultMessage } from '@lobechat/agent-gateway-client';
import { type BuiltinToolContext } from '@lobechat/types';
import debug from 'debug';
import { produce } from 'immer';

import { mcpService } from '@/services/mcp';
import { type ChatStore } from '@/store/chat/store';
import { hasExecutor, invokeExecutor } from '@/store/tool/slices/builtin/executors';
import { type StoreSetter } from '@/store/types';
import { safeParseJSON } from '@/utils/safeParseJSON';

const log = debug('lobe-store:client-tool-execution');

type Setter = StoreSetter<ChatStore>;

/**
 * Executes a Gateway `tool_execute` request locally and always returns a
 * `tool_result` — even on parse failure, missing executor, or thrown error.
 *
 * Never let the server-side BLPOP time out: the contract is that every
 * `tool_execute` produces exactly one `tool_result` back over the same WS.
 */
export class ClientToolExecutionActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_executeClientTool = async (
    data: ToolExecuteData,
    context: { operationId: string },
  ): Promise<void> => {
    const { toolCallId, identifier, apiName, arguments: argsString } = data;
    const { operationId } = context;

    log(
      '[internal_executeClientTool] start toolCallId=%s identifier=%s apiName=%s op=%s',
      toolCallId,
      identifier,
      apiName,
      operationId,
    );

    this.#setPending(toolCallId, true);

    // Captured once; must be the SAME connection that received the execute request.
    const conn = this.#get().gatewayConnections[operationId];

    const send = (payload: Omit<ToolResultMessage, 'type'>): void => {
      this.#setPending(toolCallId, false);
      if (!conn) {
        log(
          '[internal_executeClientTool] no gateway connection for op=%s toolCallId=%s — server will timeout',
          operationId,
          toolCallId,
        );
        return;
      }
      const ok = conn.client.sendToolResult(payload);
      if (!ok) {
        log(
          '[internal_executeClientTool] sendToolResult returned false (socket closed) for toolCallId=%s',
          toolCallId,
        );
      }
    };

    // ─── Parse arguments ───
    let params: any = {};
    if (argsString) {
      const parsed = safeParseJSON(argsString);
      if (parsed === undefined) {
        send({
          content: null,
          error: {
            message: `Failed to parse tool arguments: ${argsString.slice(0, 200)}`,
            type: 'arguments_parse_error',
          },
          success: false,
          toolCallId,
        });
        return;
      }
      params = parsed ?? {};
    }

    try {
      // ─── Builtin dispatch (via registry) ───
      if (hasExecutor(identifier, apiName)) {
        const operation = this.#get().operations[operationId];
        const ctx: BuiltinToolContext = {
          agentId: operation?.context?.agentId,
          groupId: operation?.context?.groupId,
          // Gateway-side tool messages are persisted on the server; the client
          // has no local message id, so reuse toolCallId as the context key.
          messageId: toolCallId,
          operationId,
          signal: operation?.abortController?.signal,
          topicId: operation?.context?.topicId ?? undefined,
        };

        const result = await invokeExecutor(identifier, apiName, params, ctx);

        if (result.error) {
          send({
            content: result.content ?? result.error.message ?? null,
            error: { message: result.error.message, type: result.error.type },
            state: result.state,
            success: false,
            toolCallId,
          });
        } else {
          send({
            content: result.content ?? null,
            state: result.state,
            success: !!result.success,
            toolCallId,
          });
        }
        return;
      }

      // ─── MCP fallback — unified dispatch, mirrors invokeMCPTypePlugin shape ───
      const operation = this.#get().operations[operationId];
      const mcpResult = await mcpService
        .invokeMcpToolCall(
          {
            apiName,
            arguments: argsString,
            id: toolCallId,
            identifier,
            type: 'default',
          },
          {
            signal: operation?.abortController?.signal,
            topicId: operation?.context?.topicId ?? undefined,
          },
        )
        .catch((err) => {
          log(
            '[internal_executeClientTool] mcp invoke threw for %s/%s: %O',
            identifier,
            apiName,
            err,
          );
          return undefined;
        });

      if (!mcpResult) {
        send({
          content: null,
          error: {
            message: `No client executor available for ${identifier}/${apiName}`,
            type: 'executor_not_found',
          },
          success: false,
          toolCallId,
        });
        return;
      }

      send({
        content: mcpResult.content ?? null,
        error: mcpResult.success
          ? undefined
          : {
              message: (mcpResult.error as any)?.message ?? 'MCP tool call failed',
              type: (mcpResult.error as any)?.type,
            },
        state: mcpResult.state,
        success: !!mcpResult.success,
        toolCallId,
      });
    } catch (error) {
      const err = error as Error;
      log('[internal_executeClientTool] unexpected error toolCallId=%s: %O', toolCallId, err);
      send({
        content: null,
        error: {
          message: err?.message || 'Unknown client tool execution error',
          type: 'client_tool_execution_error',
        },
        success: false,
        toolCallId,
      });
    }
  };

  #setPending = (toolCallId: string, pending: boolean): void => {
    this.#set(
      (state) => ({
        pendingClientToolExecutions: produce(state.pendingClientToolExecutions, (draft) => {
          if (pending) {
            draft[toolCallId] = true;
          } else {
            delete draft[toolCallId];
          }
        }),
      }),
      false,
      `pendingClientTool/${pending ? 'start' : 'end'}`,
    );
  };
}

export type ClientToolExecutionAction = Pick<
  ClientToolExecutionActionImpl,
  keyof ClientToolExecutionActionImpl
>;
