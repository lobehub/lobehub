import type { AgentRuntimeHost } from '../transport';
import type { AgentEvent, AgentInstruction, AnyHookEvent, InstructionExecutor } from '../types';

/**
 * `request_human_approve` executor — pauses the operation for human tool
 * approval (LOBE-10949 Tier A).
 *
 * Uses the `StreamSink` (event + chunk channels), `LifecycleSink`
 * (`beforeHumanIntervention` hook) and `MessageTransport` (create pending tool
 * messages / look them up on resume). Behavior mirrors the previous
 * server-local implementation.
 */
export const requestHumanApprove =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { pendingToolsCalling, skipCreateToolMessage } = instruction as Extract<
      AgentInstruction,
      { type: 'request_human_approve' }
    >;
    const { operation, transports, lifecycle } = host;
    const { operationId, stepIndex, userId } = operation;

    // Publish human approval request event
    await transports.stream.publishEvent({
      data: {
        pendingToolsCalling,
        phase: 'human_approval',
        requiresApproval: true,
      },
      stepIndex,
      type: 'step_start',
    });

    // Fire-and-forget lifecycle hook (webhook configs carried via state).
    lifecycle
      ?.dispatch({
        event: {
          operationId,
          pendingTools: pendingToolsCalling.map((t: any) => ({
            apiName: t.apiName,
            identifier: t.identifier,
          })),
          stepIndex,
          userId,
        } as AnyHookEvent,
        serializedHooks: state.metadata?._hooks,
        type: 'beforeHumanIntervention',
      })
      .catch(() => {});

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'waiting_for_human';
    newState.pendingToolsCalling = pendingToolsCalling;

    // Map of toolCallId -> toolMessageId, populated either by creating fresh
    // pending tool messages or (in resumption mode) by looking up existing ones.
    const toolMessageIds: Record<string, string> = {};

    if (skipCreateToolMessage) {
      // Resumption mode: tool messages already exist. Look them up by
      // tool_call_id so we can still ship the mapping to the client.
      try {
        const dbMessages = await transports.messages.query({
          agentId: state.metadata?.agentId,
          // Group runs need groupId or the query returns no group messages, so
          // the existing tool-message lookup on resume would find nothing.
          groupId: state.metadata?.groupId,
          threadId: state.metadata?.threadId,
          topicId: state.metadata?.topicId,
        });
        for (const toolPayload of pendingToolsCalling) {
          const existing = dbMessages.find(
            (m: any) => m.role === 'tool' && m.tool_call_id === toolPayload.id,
          );
          if (existing) {
            toolMessageIds[toolPayload.id] = existing.id;
          }
        }
      } catch {
        // best-effort lookup — a miss just omits the mapping
      }
    } else {
      // Find parent assistant message. Prefer state.messages (already in
      // memory from call_llm); fall back to a query if the runtime has been
      // rehydrated without recent messages.
      let parentAssistantId: string | undefined = (state.messages ?? [])
        .slice()
        .reverse()
        .find((m: any) => m.role === 'assistant' && m.id)?.id;

      if (!parentAssistantId) {
        try {
          const dbMessages = await transports.messages.query({
            agentId: state.metadata?.agentId,
            // Group runs need groupId or the query returns no group messages, so
            // the parent-assistant fallback lookup would find nothing.
            groupId: state.metadata?.groupId,
            threadId: state.metadata?.threadId,
            topicId: state.metadata?.topicId,
          });
          parentAssistantId = dbMessages
            .slice()
            .reverse()
            .find((m: any) => m.role === 'assistant')?.id;
        } catch {
          // fall through to the missing-parent guard below
        }
      }

      if (!parentAssistantId) {
        throw new Error(
          `[request_human_approve] No assistant message found as parent for pending tool messages (op=${operationId})`,
        );
      }

      for (const toolPayload of pendingToolsCalling) {
        const toolMessage = await transports.messages.createToolMessage({
          agentId: state.metadata!.agentId!,
          content: '',
          groupId: state.metadata?.groupId ?? undefined,
          parentId: parentAssistantId,
          plugin: toolPayload as any,
          pluginIntervention: { status: 'pending' },
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });

        toolMessageIds[toolPayload.id] = toolMessage.id;

        // Intentionally DO NOT push the empty placeholder into
        // newState.messages. When the approval resumes, the `call_tool`
        // executor (skip-create branch) appends the resolved tool message to
        // state.messages itself. Pushing a placeholder here produced two
        // entries for the same tool_call_id.
      }
    }

    // Notify frontend to display approval UI through streaming system.
    // `toolMessageIds` is a new optional field; legacy consumers ignore it.
    await transports.stream.publishChunk({
      chunkType: 'tools_calling',
      stepIndex,
      toolMessageIds,
      toolsCalling: pendingToolsCalling as any,
    });

    const events: AgentEvent[] = [
      {
        operationId,
        pendingToolsCalling,
        type: 'human_approve_required',
      },
      {
        // pendingToolsCalling is ChatToolPayload[] but AgentEventToolPending
        // expects ToolsCalling[]; intentional for frontend display.
        toolCalls: pendingToolsCalling as any,
        type: 'tool_pending',
      },
    ];

    return {
      events,
      newState,
      // No nextContext — the operation waits for human intervention.
    };
  };
