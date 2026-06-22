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
 * Fallback used when the WS payload is missing `executionTimeoutMs` (e.g. an
 * older server). Matches `GLOBAL_DEFAULT_TIMEOUT_MS` on the server side so
 * the renderer's race is never more lax than the server's BLPOP deadline.
 */
const FALLBACK_EXECUTION_TIMEOUT_MS = 120_000;

/**
 * Fire the renderer-side timeout 500ms ahead of the server's BLPOP deadline
 * so the server consistently observes an explicit `client_executor_timeout`
 * failure rather than a naked BLPOP timeout. Small enough to barely matter
 * for normal runs, large enough to absorb event-loop / WS jitter.
 */
const SAFETY_BUFFER_MS = 500;

class ClientExecutorTimeoutError extends Error {
  readonly executionTimeoutMs: number;
  constructor(executionTimeoutMs: number) {
    super(`Tool execution exceeded ${executionTimeoutMs}ms client deadline`);
    this.name = 'ClientExecutorTimeoutError';
    this.executionTimeoutMs = executionTimeoutMs;
  }
}

const resolveDeadlineMs = (executionTimeoutMs: number | undefined): number => {
  const base =
    typeof executionTimeoutMs === 'number' && executionTimeoutMs > 0
      ? executionTimeoutMs
      : FALLBACK_EXECUTION_TIMEOUT_MS;
  return Math.max(base - SAFETY_BUFFER_MS, 100);
};

/**
 * Executes a Gateway `tool_execute` request locally and always returns a
 * `tool_result` — even on parse failure, missing executor, thrown error, or
 * a deadline overrun. Never let the server-side BLPOP time out: every
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
    const { toolCallId, identifier, apiName, arguments: argsString, executionTimeoutMs } = data;
    const { operationId } = context;

    log(
      '[internal_executeClientTool] start toolCallId=%s identifier=%s apiName=%s op=%s timeout=%dms',
      toolCallId,
      identifier,
      apiName,
      operationId,
      executionTimeoutMs,
    );

    this.#setPending(toolCallId, true);

    let sent = false;
    const send = (payload: Omit<ToolResultMessage, 'type'>): void => {
      if (sent) {
        log('[internal_executeClientTool] duplicate send ignored for toolCallId=%s', toolCallId);
        return;
      }
      sent = true;

      // Look up the gateway connection at send-time, not at action-entry time.
      // Reconnects between dispatch and result land a new entry in
      // `gatewayConnections`; using a captured reference would silently
      // sendToolResult into a dead socket.
      const conn = this.#get().gatewayConnections[operationId];
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

    try {
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

      const operation = this.#get().operations[operationId];

      // ─── Builtin dispatch (via registry) ───
      if (hasExecutor(identifier, apiName)) {
        const ctx: BuiltinToolContext = {
          agentId: operation?.context?.agentId,
          documentId: operation?.context?.documentId,
          groupId: operation?.context?.groupId,
          // Gateway-side tool messages are persisted on the server; the client
          // has no local message id, so reuse toolCallId as the context key.
          messageId: toolCallId,
          operationId,
          scope: operation?.context?.scope,
          signal: operation?.abortController?.signal,
          sourceMessageId: operation?.context?.messageId,
          topicId: operation?.context?.topicId ?? undefined,
        };

        log('[ClientToolCall] execute:start', {
          agentId: ctx.agentId,
          apiName,
          documentId: ctx.documentId,
          identifier,
          operationId,
          scope: ctx.scope,
          toolCallId,
          topicId: ctx.topicId,
        });

        const result = await this.#raceAgainstDeadline(
          () => invokeExecutor(identifier, apiName, params, ctx),
          executionTimeoutMs,
          () => operation?.abortController?.abort(),
        );

        log('[ClientToolCall] execute:end', {
          apiName,
          errorType: result.error?.type,
          identifier,
          operationId,
          success: result.success,
          toolCallId,
        });

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
      const mcpResult = await this.#raceAgainstDeadline(
        () =>
          mcpService
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
            }),
        executionTimeoutMs,
        () => operation?.abortController?.abort(),
      );

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
      if (error instanceof ClientExecutorTimeoutError) {
        log(
          '[internal_executeClientTool] timeout toolCallId=%s after %dms',
          toolCallId,
          error.executionTimeoutMs,
        );
        send({
          content: null,
          error: {
            message: `Tool exceeded ${error.executionTimeoutMs}ms deadline. Raise \`timeout\` in the next call's arguments if this is expected.`,
            type: 'client_executor_timeout',
          },
          success: false,
          toolCallId,
        });
        return;
      }
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
    } finally {
      // Last-resort safety net: every `tool_execute` must produce exactly
      // one `tool_result`. If every branch above somehow missed `send()`,
      // emit a default failure here so the server's BLPOP wakes up.
      if (!sent) {
        log(
          '[internal_executeClientTool] no send observed for toolCallId=%s; emitting default failure',
          toolCallId,
        );
        send({
          content: null,
          error: {
            message: 'Client tool execution finished without producing a result',
            type: 'client_executor_no_result',
          },
          success: false,
          toolCallId,
        });
      }
      this.#setPending(toolCallId, false);
    }
  };

  /**
   * Race a task against the server-supplied execution deadline. Trips
   * `SAFETY_BUFFER_MS` ahead of the server's BLPOP so the renderer can emit a
   * structured timeout failure instead of letting the server time out blindly.
   * On timeout, calls `onTimeout` (typically `abortController.abort()`) so the
   * executor / IPC layer can interrupt in-flight work.
   */
  #raceAgainstDeadline = async <T>(
    task: () => Promise<T>,
    executionTimeoutMs: number | undefined,
    onTimeout: () => void,
  ): Promise<T> => {
    const deadlineMs = resolveDeadlineMs(executionTimeoutMs);
    const budgetMs = executionTimeoutMs ?? FALLBACK_EXECUTION_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            try {
              onTimeout();
            } catch (err) {
              log('[raceAgainstDeadline] onTimeout threw: %O', err);
            }
            reject(new ClientExecutorTimeoutError(budgetMs));
          }, deadlineMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
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
