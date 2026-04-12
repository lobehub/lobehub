import type { HeterogeneousAgentEvent, ToolCallPayload } from '@lobechat/heterogeneous-agents';
import { createAdapter } from '@lobechat/heterogeneous-agents';
import type { ConversationContext, HeterogeneousProviderConfig } from '@lobechat/types';

import type { AgentStreamEvent } from '@/libs/agent-stream/types';
import { acpService } from '@/services/electron/acp';
import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

import { createGatewayEventHandler } from './gatewayEventHandler';

export interface ACPExecutorParams {
  assistantMessageId: string;
  context: ConversationContext;
  heterogeneousProvider: HeterogeneousProviderConfig;
  message: string;
  operationId: string;
  workingDirectory?: string;
}

/**
 * Map heterogeneousProvider.command to adapter type key.
 */
const resolveAdapterType = (config: HeterogeneousProviderConfig): string => {
  // Explicit adapterType in config takes priority
  if ((config as any).adapterType) return (config as any).adapterType;

  // Infer from command name
  const cmd = config.command || 'claude';
  if (cmd.includes('claude')) return 'claude-code';
  if (cmd.includes('codex')) return 'codex';
  if (cmd.includes('kimi')) return 'kimi-cli';

  return 'claude-code'; // default
};

/**
 * Convert HeterogeneousAgentEvent to AgentStreamEvent (add operationId).
 */
const toStreamEvent = (event: HeterogeneousAgentEvent, operationId: string): AgentStreamEvent => ({
  data: event.data,
  operationId,
  stepIndex: event.stepIndex,
  timestamp: event.timestamp,
  type: event.type,
});

/**
 * Subscribe to Electron IPC broadcasts for raw agent lines.
 * Returns unsubscribe function.
 */
const subscribeBroadcasts = (
  sessionId: string,
  callbacks: {
    onComplete: () => void;
    onError: (error: string) => void;
    onRawLine: (line: any) => void;
  },
): (() => void) => {
  if (!window.electron?.ipcRenderer) return () => {};

  const ipc = window.electron.ipcRenderer;

  const onLine = (_e: any, data: { line: any; sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onRawLine(data.line);
  };
  const onComplete = (_e: any, data: { sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onComplete();
  };
  const onError = (_e: any, data: { error: string; sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onError(data.error);
  };

  ipc.on('acpRawLine' as any, onLine);
  ipc.on('acpSessionComplete' as any, onComplete);
  ipc.on('acpSessionError' as any, onError);

  return () => {
    ipc.removeListener('acpRawLine' as any, onLine);
    ipc.removeListener('acpSessionComplete' as any, onComplete);
    ipc.removeListener('acpSessionError' as any, onError);
  };
};

/**
 * Persisted tool-call registry for a single ACP execution.
 *
 * Tracks which tool_use ids have been persisted to avoid duplicates,
 * and holds the enriched payload (with result_msg_id) that gets written
 * back to the assistant message's tools JSONB.
 */
interface ToolPersistenceState {
  /** Ordered list of ChatToolPayload[] written to assistant.tools */
  payloads: (ToolCallPayload & { result_msg_id?: string })[];
  /** Set of tool_use.id that have been persisted (de-dupe guard) */
  persistedIds: Set<string>;
  /** Map tool_use.id → tool message DB id (for later content update on tool_result) */
  toolMsgIdByCallId: Map<string, string>;
}

/**
 * Persist any newly-seen tool calls and update the assistant message's tools JSONB.
 *
 * Guarantees:
 * - One tool message per unique tool_use.id (idempotent against re-processing)
 * - assistant.tools[].result_msg_id is set to the created tool message id, so
 *   the UI's parse() step can link tool messages back to the assistant turn
 *   (otherwise they render as orphan warnings).
 */
const persistNewToolCalls = async (
  incoming: ToolCallPayload[],
  state: ToolPersistenceState,
  assistantMessageId: string,
  context: ConversationContext,
) => {
  const freshTools = incoming.filter((t) => !state.persistedIds.has(t.id));
  if (freshTools.length === 0) return;

  // Mark all fresh tools as persisted up front, so re-entrant calls (from
  // Claude Code echoing tool_use blocks) are safely deduped.
  for (const tool of freshTools) state.persistedIds.add(tool.id);

  // ─── PHASE 1: Write tools[] to assistant FIRST, WITHOUT result_msg_id ───
  //
  // LobeHub's conversation-flow parser filters tool messages by matching
  // `tool.tool_call_id` against `assistant.tools[].id`. If a tool message
  // exists in DB but no matching entry exists in assistant.tools[], the UI
  // renders an "orphan" warning telling the user to delete it.
  //
  // By writing assistant.tools[] FIRST (with the tool ids but no result_msg_id
  // yet), the match works from the moment tool messages get created in DB.
  // No orphan window.
  for (const tool of freshTools) state.payloads.push({ ...tool });
  try {
    await messageService.updateMessage(
      assistantMessageId,
      { tools: state.payloads },
      { agentId: context.agentId, topicId: context.topicId },
    );
  } catch (err) {
    console.error('[ACP] Failed to pre-register assistant tools:', err);
  }

  // ─── PHASE 2: Create the tool messages in DB ───
  // Each tool message's tool_call_id matches an already-registered tool id
  // in assistant.tools[], so UI never sees orphan state.
  for (const tool of freshTools) {
    try {
      const result = await messageService.createMessage({
        agentId: context.agentId,
        content: '',
        parentId: assistantMessageId,
        plugin: {
          apiName: tool.apiName,
          arguments: tool.arguments,
          identifier: tool.identifier,
          type: tool.type,
        },
        role: 'tool',
        tool_call_id: tool.id,
        topicId: context.topicId ?? undefined,
      });
      state.toolMsgIdByCallId.set(tool.id, result.id);
      // Back-fill result_msg_id onto the payload we pushed in PHASE 1
      const entry = state.payloads.find((p) => p.id === tool.id);
      if (entry) entry.result_msg_id = result.id;
    } catch (err) {
      console.error('[ACP] Failed to create tool message:', err);
    }
  }

  // ─── PHASE 3: Re-write assistant.tools[] with the result_msg_ids ───
  // Without this, the UI can't hydrate tool results back into the inspector.
  try {
    await messageService.updateMessage(
      assistantMessageId,
      { tools: state.payloads },
      { agentId: context.agentId, topicId: context.topicId },
    );
  } catch (err) {
    console.error('[ACP] Failed to finalize assistant tools:', err);
  }
};

/**
 * Update a tool message's content in DB when tool_result arrives.
 */
const persistToolResult = async (
  toolCallId: string,
  content: string,
  isError: boolean,
  state: ToolPersistenceState,
  context: ConversationContext,
) => {
  const toolMsgId = state.toolMsgIdByCallId.get(toolCallId);
  if (!toolMsgId) {
    console.warn('[ACP] tool_result for unknown toolCallId:', toolCallId);
    return;
  }

  try {
    await messageService.updateToolMessage(
      toolMsgId,
      {
        content,
        pluginError: isError ? { message: content } : undefined,
      },
      {
        agentId: context.agentId,
        topicId: context.topicId,
      },
    );
  } catch (err) {
    console.error('[ACP] Failed to update tool message content:', err);
  }
};

/**
 * Execute a prompt via an external agent CLI.
 *
 * Flow:
 * 1. Subscribe to IPC broadcasts
 * 2. Spawn agent process via acpService
 * 3. Raw stdout lines → Adapter → HeterogeneousAgentEvent → AgentStreamEvent
 * 4. Feed AgentStreamEvents into createGatewayEventHandler (unified handler)
 * 5. Tool messages created via messageService before emitting tool events
 */
export const executeACPAgent = async (
  get: () => ChatStore,
  params: ACPExecutorParams,
): Promise<void> => {
  const {
    heterogeneousProvider,
    assistantMessageId,
    context,
    message,
    operationId,
    workingDirectory,
  } = params;

  // Create adapter for this agent type
  const adapterType = resolveAdapterType(heterogeneousProvider);
  const adapter = createAdapter(adapterType);

  // Create the unified event handler (same one Gateway uses)
  const eventHandler = createGatewayEventHandler(get, {
    assistantMessageId,
    context,
    operationId,
  });

  let acpSessionId: string | undefined;
  let unsubscribe: (() => void) | undefined;
  let completed = false;

  // Track state for DB persistence
  const toolState: ToolPersistenceState = {
    payloads: [],
    persistedIds: new Set(),
    toolMsgIdByCallId: new Map(),
  };
  /** Serializes async persist operations so ordering is stable. */
  let persistQueue: Promise<void> = Promise.resolve();
  /** Content accumulators — Gateway server persists these during streaming;
   * ACP has no server so we persist at onComplete. */
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  /** Extracted model + usage from each assistant event (used for final write) */
  let lastModel: string | undefined;
  const accumulatedUsage: Record<string, number> = {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
  };
  /**
   * Deferred terminal event (agent_runtime_end or error). We don't forward
   * these to the gateway handler immediately because handler triggers
   * fetchAndReplaceMessages which would clobber our in-flight content
   * writes with stale DB state. onComplete forwards after persistence.
   */
  let deferredTerminalEvent: HeterogeneousAgentEvent | null = null;

  try {
    // Start session
    const result = await acpService.startSession({
      agentType: adapterType,
      args: heterogeneousProvider.args,
      command: heterogeneousProvider.command || 'claude',
      cwd: workingDirectory,
      env: heterogeneousProvider.env,
    });
    acpSessionId = result.sessionId;

    // Subscribe to broadcasts BEFORE sending prompt
    unsubscribe = subscribeBroadcasts(acpSessionId, {
      onRawLine: (line) => {
        const events = adapter.adapt(line);

        for (const event of events) {
          // ─── tool_result: update tool message content in DB (ACP-only) ───
          if (event.type === 'tool_result') {
            const { content, isError, toolCallId } = event.data as {
              content: string;
              isError?: boolean;
              toolCallId: string;
            };
            persistQueue = persistQueue.then(() =>
              persistToolResult(toolCallId, content, !!isError, toolState, context),
            );
            // Don't forward — the tool_end that follows triggers fetchAndReplaceMessages
            // which reads the updated content from DB.
            continue;
          }

          // ─── step_complete with turn_metadata: capture model + usage ───
          if (event.type === 'step_complete' && event.data?.phase === 'turn_metadata') {
            if (event.data.model) lastModel = event.data.model;
            if (event.data.usage) {
              // Accumulate token usage across all turns
              accumulatedUsage.input_tokens += event.data.usage.input_tokens || 0;
              accumulatedUsage.output_tokens += event.data.usage.output_tokens || 0;
              accumulatedUsage.cache_creation_input_tokens +=
                event.data.usage.cache_creation_input_tokens || 0;
              accumulatedUsage.cache_read_input_tokens +=
                event.data.usage.cache_read_input_tokens || 0;
            }
            // Don't forward turn metadata — it's internal bookkeeping
            continue;
          }

          // ─── Defer terminal events so content writes complete first ───
          // Gateway handler's agent_runtime_end/error triggers fetchAndReplaceMessages,
          // which would read stale DB state (before we persist final content + usage).
          if (event.type === 'agent_runtime_end' || event.type === 'error') {
            deferredTerminalEvent = event;
            continue;
          }

          // ─── stream_chunk: accumulate content + persist tool_use ───
          if (event.type === 'stream_chunk') {
            const chunk = event.data;
            if (chunk?.chunkType === 'text' && chunk.content) {
              accumulatedContent += chunk.content;
            }
            if (chunk?.chunkType === 'reasoning' && chunk.reasoning) {
              accumulatedReasoning += chunk.reasoning;
            }
            if (chunk?.chunkType === 'tools_calling') {
              const tools = chunk.toolsCalling as ToolCallPayload[];
              if (tools?.length) {
                persistQueue = persistQueue.then(() =>
                  persistNewToolCalls(tools, toolState, assistantMessageId, context),
                );
              }
            }
          }

          // Forward all other events to the unified Gateway handler
          eventHandler(toStreamEvent(event, operationId));
        }
      },

      onComplete: async () => {
        if (completed) return;
        completed = true;

        // Flush remaining adapter state (e.g., still-open tool_end events — but
        // NOT agent_runtime_end; that's deferred below)
        const flushEvents = adapter.flush();
        for (const event of flushEvents) {
          if (event.type === 'agent_runtime_end' || event.type === 'error') {
            deferredTerminalEvent = event;
            continue;
          }
          eventHandler(toStreamEvent(event, operationId));
        }

        // Wait for all tool persistence to finish before writing final state
        await persistQueue.catch(console.error);

        // Persist final content + reasoning + model + usage to the assistant message
        // BEFORE the terminal event triggers fetchAndReplaceMessages.
        const updateValue: Record<string, any> = {};
        if (accumulatedContent) updateValue.content = accumulatedContent;
        if (accumulatedReasoning) updateValue.reasoning = { content: accumulatedReasoning };
        if (lastModel) updateValue.model = lastModel;
        if (accumulatedUsage.input_tokens + accumulatedUsage.output_tokens > 0) {
          updateValue.metadata = {
            totalInputTokens:
              accumulatedUsage.input_tokens +
              accumulatedUsage.cache_creation_input_tokens +
              accumulatedUsage.cache_read_input_tokens,
            totalOutputTokens: accumulatedUsage.output_tokens,
            totalTokens:
              accumulatedUsage.input_tokens +
              accumulatedUsage.output_tokens +
              accumulatedUsage.cache_creation_input_tokens +
              accumulatedUsage.cache_read_input_tokens,
          };
        }

        if (Object.keys(updateValue).length > 0) {
          await messageService
            .updateMessage(assistantMessageId, updateValue, {
              agentId: context.agentId,
              topicId: context.topicId,
            })
            .catch(console.error);
        }

        // NOW forward the deferred terminal event — handler will fetchAndReplaceMessages
        // and pick up the final persisted state.
        const terminal = deferredTerminalEvent ?? {
          data: {},
          stepIndex: 0,
          timestamp: Date.now(),
          type: 'agent_runtime_end' as const,
        };
        eventHandler(toStreamEvent(terminal, operationId));
      },

      onError: async (error) => {
        if (completed) return;
        completed = true;

        await persistQueue.catch(console.error);

        if (accumulatedContent) {
          await messageService
            .updateMessage(
              assistantMessageId,
              { content: accumulatedContent },
              {
                agentId: context.agentId,
                topicId: context.topicId,
              },
            )
            .catch(console.error);
        }

        eventHandler(
          toStreamEvent(
            {
              data: { error, message: error },
              stepIndex: 0,
              timestamp: Date.now(),
              type: 'error',
            },
            operationId,
          ),
        );
      },
    });

    // Send the prompt — blocks until process exits
    await acpService.sendPrompt(acpSessionId, message);

    // Store agent session ID for multi-turn resume
    const sessionInfo = await acpService.getSessionInfo(acpSessionId).catch(() => null);
    if (sessionInfo?.agentSessionId && context.topicId) {
      // TODO: persist to topic.metadata for cross-restart resume
      // For now, agent session ID is only in memory (AcpCtr stores it)
    }
  } catch (error) {
    if (!completed) {
      completed = true;
      const errorMsg = error instanceof Error ? error.message : 'Agent execution failed';
      eventHandler(
        toStreamEvent(
          {
            data: { error: errorMsg, message: errorMsg },
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'error',
          },
          operationId,
        ),
      );
    }
  } finally {
    unsubscribe?.();
    if (acpSessionId) {
      acpService.stopSession(acpSessionId).catch(() => {});
    }
  }
};
