import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { isDesktop } from '@lobechat/const';
import type { HeterogeneousAgentEvent, ToolCallPayload } from '@lobechat/heterogeneous-agents';
import { createAdapter } from '@lobechat/heterogeneous-agents';
import type {
  ChatToolPayload,
  ConversationContext,
  HeterogeneousProviderConfig,
} from '@lobechat/types';
import { t } from 'i18next';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { createGatewayEventHandler } from './gatewayEventHandler';

/**
 * Fire desktop notification + dock badge when a CC/Codex/ACP run finishes.
 * Notification only shows when the window is hidden (enforced in main); the
 * badge is always set so a minimized/backgrounded app still signals completion.
 */
const notifyCompletion = async (title: string, body: string) => {
  if (!isDesktop) return;
  try {
    const { desktopNotificationService } = await import('@/services/electron/desktopNotification');
    await Promise.allSettled([
      desktopNotificationService.showNotification({ body, title }),
      desktopNotificationService.setBadgeCount(1),
    ]);
  } catch (error) {
    console.error('[HeterogeneousAgent] Desktop notification failed:', error);
  }
};

export interface HeterogeneousAgentExecutorParams {
  assistantMessageId: string;
  context: ConversationContext;
  heterogeneousProvider: HeterogeneousProviderConfig;
  /** Image attachments from user message — passed to Main for vision support */
  imageList?: Array<{ id: string; url: string }>;
  message: string;
  operationId: string;
  /** CC session ID from previous execution in this topic (for --resume) */
  resumeSessionId?: string;
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
  type: event.type as AgentStreamEvent['type'],
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

  ipc.on('heteroAgentRawLine' as any, onLine);
  ipc.on('heteroAgentSessionComplete' as any, onComplete);
  ipc.on('heteroAgentSessionError' as any, onError);

  return () => {
    ipc.removeListener('heteroAgentRawLine' as any, onLine);
    ipc.removeListener('heteroAgentSessionComplete' as any, onComplete);
    ipc.removeListener('heteroAgentSessionError' as any, onError);
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
  payloads: ChatToolPayload[];
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
 * - Carries the latest accumulated text/reasoning into the same UPDATE, so DB
 *   stays in sync with what's been streamed. Without this, gateway handler's
 *   `tool_end → fetchAndReplaceMessages` would read a tools-only/no-content
 *   row and clobber the in-memory streamed text in the UI.
 */
const persistNewToolCalls = async (
  incoming: ToolCallPayload[],
  state: ToolPersistenceState,
  assistantMessageId: string,
  context: ConversationContext,
  snapshot: { content: string; reasoning: string },
) => {
  const freshTools = incoming.filter((t) => !state.persistedIds.has(t.id));
  if (freshTools.length === 0) return;

  // Mark all fresh tools as persisted up front, so re-entrant calls (from
  // Claude Code echoing tool_use blocks) are safely deduped.
  for (const tool of freshTools) state.persistedIds.add(tool.id);

  const buildUpdate = (): Record<string, any> => {
    const update: Record<string, any> = { tools: state.payloads };
    if (snapshot.content) update.content = snapshot.content;
    if (snapshot.reasoning) update.reasoning = { content: snapshot.reasoning };
    return update;
  };

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
  for (const tool of freshTools) state.payloads.push({ ...tool } as ChatToolPayload);
  try {
    await messageService.updateMessage(assistantMessageId, buildUpdate(), {
      agentId: context.agentId,
      topicId: context.topicId,
    });
  } catch (err) {
    console.error('[HeterogeneousAgent] Failed to pre-register assistant tools:', err);
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
          type: tool.type as ChatToolPayload['type'],
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
      console.error('[HeterogeneousAgent] Failed to create tool message:', err);
    }
  }

  // ─── PHASE 3: Re-write assistant.tools[] with the result_msg_ids ───
  // Without this, the UI can't hydrate tool results back into the inspector.
  try {
    await messageService.updateMessage(assistantMessageId, buildUpdate(), {
      agentId: context.agentId,
      topicId: context.topicId,
    });
  } catch (err) {
    console.error('[HeterogeneousAgent] Failed to finalize assistant tools:', err);
  }
};

/**
 * Update a tool message's content in DB when tool_result arrives.
 *
 * `pluginState` (when provided by the adapter) is written in the same request
 * as `content` so downstream consumers observe a single atomic update —
 * critical for `selectTodosFromMessages` which reads both role=tool and
 * `pluginState.todos` in one pass.
 */
const persistToolResult = async (
  toolCallId: string,
  content: string,
  isError: boolean,
  state: ToolPersistenceState,
  context: ConversationContext,
  pluginState?: Record<string, any>,
) => {
  const toolMsgId = state.toolMsgIdByCallId.get(toolCallId);
  if (!toolMsgId) {
    console.warn('[HeterogeneousAgent] tool_result for unknown toolCallId:', toolCallId);
    return;
  }

  try {
    await messageService.updateToolMessage(
      toolMsgId,
      {
        content,
        pluginError: isError ? { message: content } : undefined,
        pluginState,
      },
      {
        agentId: context.agentId,
        topicId: context.topicId,
      },
    );
  } catch (err) {
    console.error('[HeterogeneousAgent] Failed to update tool message content:', err);
  }
};

/**
 * Execute a prompt via an external agent CLI.
 *
 * Flow:
 * 1. Subscribe to IPC broadcasts
 * 2. Spawn agent process via heterogeneousAgentService
 * 3. Raw stdout lines → Adapter → HeterogeneousAgentEvent → AgentStreamEvent
 * 4. Feed AgentStreamEvents into createGatewayEventHandler (unified handler)
 * 5. Tool messages created via messageService before emitting tool events
 */
export const executeHeterogeneousAgent = async (
  get: () => ChatStore,
  params: HeterogeneousAgentExecutorParams,
): Promise<void> => {
  const {
    heterogeneousProvider,
    assistantMessageId,
    context,
    imageList,
    message,
    operationId,
    resumeSessionId,
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

  let agentSessionId: string | undefined;
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
  /** Tracks the current assistant message being written to (switches on new steps) */
  let currentAssistantMessageId = assistantMessageId;
  /** Content accumulators — reset on each new step */
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  /** Latest model string — updated per turn, written alongside content on step boundaries. */
  let lastModel: string | undefined;
  /** Adapter/CLI provider (e.g. `claude-code`) — carried on every turn_metadata. */
  let lastProvider: string | undefined;
  /**
   * Deferred terminal event (agent_runtime_end or error). We don't forward
   * these to the gateway handler immediately because handler triggers
   * fetchAndReplaceMessages which would clobber our in-flight content
   * writes with stale DB state. onComplete forwards after persistence.
   */
  let deferredTerminalEvent: HeterogeneousAgentEvent | null = null;
  /**
   * True while a step transition is in flight (stream_start queued but not yet
   * forwarded to handler). Events that would normally be forwarded sync must
   * be deferred through persistQueue so the handler receives stream_start first.
   * Without this, tools_calling gets dispatched to the OLD assistant → orphan.
   */
  let pendingStepTransition = false;

  // Subscribe to the operation's abort signal so we can drop late events and
  // stop writing to DB the moment the user clicks Stop. If the op is gone
  // (cleaned up already) or missing in a test stub, treat as not-aborted.
  const abortSignal = get().operations?.[operationId]?.abortController?.signal;
  const isAborted = () => !!abortSignal?.aborted;

  try {
    // Start session (pass resumeSessionId for multi-turn --resume)
    const result = await heterogeneousAgentService.startSession({
      agentType: adapterType,
      args: heterogeneousProvider.args,
      command: heterogeneousProvider.command || 'claude',
      cwd: workingDirectory,
      env: heterogeneousProvider.env,
      resumeSessionId,
    });
    agentSessionId = result.sessionId;
    if (!agentSessionId) throw new Error('Agent session returned no sessionId');

    // Register cancel hook on the operation — when the user hits Stop, the op
    // framework calls this; we SIGINT the CC process via the main-process IPC
    // so the CLI exits instead of running to completion off-screen.
    const sidForCancel = agentSessionId;
    get().onOperationCancel?.(operationId, () => {
      heterogeneousAgentService.cancelSession(sidForCancel).catch(() => {});
    });

    // ─── Debug tracing (dev only) ───
    const trace: Array<{ adaptedEvents: any[]; rawLine: any; timestamp: number }> = [];
    if (typeof window !== 'undefined') {
      (window as any).__HETERO_AGENT_TRACE = trace;
    }

    // Subscribe to broadcasts BEFORE sending prompt
    unsubscribe = subscribeBroadcasts(agentSessionId, {
      onRawLine: (line) => {
        // Once the user cancels, drop any trailing events the CLI emits before
        // exit so they don't leak into DB writes.
        if (isAborted()) return;
        const events = adapter.adapt(line);

        // Record for debugging
        trace.push({
          adaptedEvents: events.map((e) => ({ data: e.data, type: e.type })),
          rawLine: line,
          timestamp: Date.now(),
        });

        for (const event of events) {
          // ─── tool_result: update tool message content in DB (ACP-only) ───
          if (event.type === 'tool_result') {
            const { content, isError, pluginState, toolCallId } = event.data as {
              content: string;
              isError?: boolean;
              pluginState?: Record<string, any>;
              toolCallId: string;
            };
            persistQueue = persistQueue.then(() =>
              persistToolResult(toolCallId, content, !!isError, toolState, context, pluginState),
            );
            // Don't forward — the tool_end that follows triggers fetchAndReplaceMessages
            // which reads the updated content from DB.
            continue;
          }

          // ─── step_complete with turn_metadata: persist per-step usage ───
          // `turn_metadata.usage` is the per-turn delta (deduped by adapter per
          // message.id) and already normalized to the MessageMetadata.usage
          // shape — write it straight through to the current step's assistant
          // message. Queue the write so it lands after any in-flight
          // stream_start(newStep) that may still be swapping
          // `currentAssistantMessageId` to the new step's message.
          //
          // `result_usage` (grand total across all turns) is intentionally
          // ignored — applying it would overwrite the last step with the sum
          // of all prior steps. Sum of turn_metadata equals result_usage for
          // a healthy run.
          if (event.type === 'step_complete' && event.data?.phase === 'turn_metadata') {
            if (event.data.model) lastModel = event.data.model;
            if (event.data.provider) lastProvider = event.data.provider;
            const turnUsage = event.data.usage;
            if (turnUsage) {
              persistQueue = persistQueue.then(async () => {
                await messageService
                  .updateMessage(
                    currentAssistantMessageId,
                    { metadata: { usage: turnUsage } },
                    { agentId: context.agentId, topicId: context.topicId },
                  )
                  .catch(console.error);
              });
            }
            // Don't forward turn metadata — it's internal bookkeeping
            continue;
          }

          // ─── stream_start with newStep: new LLM turn, create new assistant message ───
          if (event.type === 'stream_start' && event.data?.newStep) {
            // ⚠️ Snapshot CONTENT accumulators synchronously — stream_chunk events for
            // the new step arrive in the same onRawLine batch and would contaminate.
            // Tool state (toolMsgIdByCallId) is populated ASYNC by persistQueue, so
            // it must be read inside the queue where previous persists have completed.
            const prevContent = accumulatedContent;
            const prevReasoning = accumulatedReasoning;
            const prevModel = lastModel;
            const prevProvider = lastProvider;

            // Reset content accumulators synchronously so new-step chunks go to fresh state
            accumulatedContent = '';
            accumulatedReasoning = '';

            // Mark that we're in a step transition. Events from the same onRawLine
            // batch (stream_chunk, tool_start, etc.) must be deferred through
            // persistQueue so the handler receives stream_start FIRST — otherwise
            // it dispatches tools to the OLD assistant (orphan tool bug).
            pendingStepTransition = true;

            persistQueue = persistQueue.then(async () => {
              // Persist previous step's content to its assistant message
              const prevUpdate: Record<string, any> = {};
              if (prevContent) prevUpdate.content = prevContent;
              if (prevReasoning) prevUpdate.reasoning = { content: prevReasoning };
              if (prevModel) prevUpdate.model = prevModel;
              if (prevProvider) prevUpdate.provider = prevProvider;
              if (Object.keys(prevUpdate).length > 0) {
                await messageService
                  .updateMessage(currentAssistantMessageId, prevUpdate, {
                    agentId: context.agentId,
                    topicId: context.topicId,
                  })
                  .catch(console.error);
              }

              // Create new assistant message for this step.
              // parentId should point to the last tool message from the previous step
              // (if any), forming the chain: assistant → tool → assistant → tool → ...
              // If no tool was used, fall back to the previous assistant message.
              // Read toolMsgIdByCallId HERE (async) because it's populated by prior persists.
              const lastToolMsgId = [...toolState.toolMsgIdByCallId.values()].pop();
              const stepParentId = lastToolMsgId || currentAssistantMessageId;

              const newMsg = await messageService.createMessage({
                agentId: context.agentId,
                content: '',
                model: lastModel,
                parentId: stepParentId,
                provider: lastProvider,
                role: 'assistant',
                topicId: context.topicId ?? undefined,
              });
              currentAssistantMessageId = newMsg.id;

              // Associate the new message with the operation
              get().associateMessageWithOperation(currentAssistantMessageId, operationId);

              // Reset tool state AFTER reading — new-step tool persists are queued
              // AFTER this handler, so they'll write to the clean state.
              toolState.payloads = [];
              toolState.persistedIds.clear();
              toolState.toolMsgIdByCallId.clear();
            });

            // Update the stream_start event to carry the new message ID
            // so the gateway handler can switch to it
            persistQueue = persistQueue.then(() => {
              event.data.assistantMessage = { id: currentAssistantMessageId };
              eventHandler(toStreamEvent(event, operationId));
              // Step transition complete — handler has the new assistant ID now
              pendingStepTransition = false;
            });
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
                // Snapshot accumulators sync — must travel with the same step's
                // assistantMessageId. A late-bound getter would read NEW step's
                // content if a step transition lands between scheduling and
                // execution, while assistantMessageId would still be the OLD
                // one (also captured sync) → cross-step contamination.
                const snapshot = {
                  content: accumulatedContent,
                  reasoning: accumulatedReasoning,
                };
                persistQueue = persistQueue.then(() =>
                  persistNewToolCalls(
                    tools,
                    toolState,
                    currentAssistantMessageId,
                    context,
                    snapshot,
                  ),
                );
              }
            }
          }

          // Forward to the unified Gateway handler.
          // If a step transition is pending, defer through persistQueue so the
          // handler receives stream_start (with new assistant ID) FIRST.
          if (pendingStepTransition) {
            const snapshot = toStreamEvent(event, operationId);
            persistQueue = persistQueue.then(() => {
              eventHandler(snapshot);
            });
          } else {
            eventHandler(toStreamEvent(event, operationId));
          }
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

        // Persist final content + reasoning + model for the last step BEFORE the
        // terminal event triggers fetchAndReplaceMessages. Usage for this step
        // was already written per-turn via the turn_metadata branch.
        const updateValue: Record<string, any> = {};
        if (accumulatedContent) updateValue.content = accumulatedContent;
        if (accumulatedReasoning) updateValue.reasoning = { content: accumulatedReasoning };
        if (lastModel) updateValue.model = lastModel;
        if (lastProvider) updateValue.provider = lastProvider;

        if (Object.keys(updateValue).length > 0) {
          await messageService
            .updateMessage(currentAssistantMessageId, updateValue, {
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

        // Signal completion to the user — dock badge + (window-hidden) notification.
        // Skip for aborted runs and for error terminations.
        if (!isAborted() && deferredTerminalEvent?.type !== 'error') {
          const body = accumulatedContent
            ? markdownToTxt(accumulatedContent)
            : t('notification.finishChatGeneration', { ns: 'electron' });
          notifyCompletion(t('notification.finishChatGeneration', { ns: 'electron' }), body);
        }
      },

      onError: async (error) => {
        if (completed) return;
        completed = true;

        await persistQueue.catch(console.error);

        if (accumulatedContent) {
          await messageService
            .updateMessage(
              currentAssistantMessageId,
              { content: accumulatedContent },
              {
                agentId: context.agentId,
                topicId: context.topicId,
              },
            )
            .catch(console.error);
        }

        // If the error came from a user-initiated cancel (SIGINT → non-zero
        // exit), don't surface it as a runtime error toast — the operation is
        // already marked cancelled and the partial content is persisted above.
        if (isAborted()) return;

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
    await heterogeneousAgentService.sendPrompt(agentSessionId, message, imageList);

    // Persist heterogeneous-agent session id + the cwd it was created under,
    // for multi-turn resume. CC stores sessions per-cwd
    // (`~/.claude/projects/<encoded-cwd>/`), so the next turn must verify the
    // cwd hasn't changed before `--resume`. Reuses `workingDirectory` as the
    // topic-level binding — pinning the topic to this cwd once the agent has
    // executed here.
    if (adapter.sessionId && context.topicId) {
      get().updateTopicMetadata(context.topicId, {
        heteroSessionId: adapter.sessionId,
        workingDirectory: workingDirectory ?? '',
      });
    }
  } catch (error) {
    if (!completed) {
      completed = true;
      // `sendPrompt` rejects when the CLI exits non-zero, which is how SIGINT
      // lands here too. If the user cancelled, don't surface an error.
      if (isAborted()) return;
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
    // Don't stopSession here — keep it alive for multi-turn resume.
    // Session cleanup happens on topic deletion or Electron quit.
  }
};
