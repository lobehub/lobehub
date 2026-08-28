import type { AgentRuntimeHost } from '../transport';
import type { AgentEvent, AgentInstruction, AnyHookEvent, InstructionExecutor } from '../types';

/**
 * `request_human_approve` executor — pauses the operation for human tool
 * approval (Tier A — the most critical executor that requires human
 * intervention for sensitive operations).
 *
 * Uses the `StreamSink` (event + chunk channels), `LifecycleSink`
 * (`beforeHumanIntervention` hook) and `MessageTransport` (create pending tool
 * messages / look them up on resume). Behavior mirrors the previous
 * server-local implementation.
 */
export const requestHumanApprove =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const {
      parentMessageId,
      pendingToolsCalling,
      skipCreateToolMessage,
      supersedes: instructionSupersedes,
    } = instruction as Extract<AgentInstruction, { type: 'request_human_approve' }>;
    const { operation, transports, lifecycle } = host;
    const { operationId, stepIndex, userId } = operation;
    const agentId = operation.agentId ?? state.metadata?.agentId;
    const groupId = operation.groupId ?? state.metadata?.groupId;
    const threadId = operation.threadId ?? state.metadata?.threadId;
    const topicId = operation.topicId ?? state.metadata?.topicId;

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

    // A resume op (approve / answer) seeds an assistant placeholder up front so
    // the UI has a spinner row, and the first `call_llm` claims it. Parking here
    // means no `call_llm` ever ran — the tool executed, and the batch still has
    // unresolved siblings — so that placeholder would be left behind as an empty
    // "…" assistant hanging off the tool we just settled. Retire it: the next
    // resume seeds its own, and the run has produced no assistant content to
    // keep. Best-effort — a failed delete must not strand the approval pause.
    if (newState.pendingAssistantMessageId) {
      const orphanId = newState.pendingAssistantMessageId;
      newState.pendingAssistantMessageId = undefined;
      try {
        await transports.messages.deleteMessage(orphanId);
      } catch {
        // leaving the placeholder is cosmetic; parking correctly is not
      }
    }

    // Map of toolCallId -> toolMessageId, populated either by creating fresh
    // pending tool messages or (in resumption mode) by looking up existing ones.
    const toolMessageIds: Record<string, string> = {};
    let approvalAssistantMessageId = parentMessageId;
    let supersedes: { batchId: string; operationId: string; toolCallIds: string[] } | undefined;

    if (skipCreateToolMessage) {
      // The payloads came from the authoritative pending tool rows. Preserve
      // their previous generic batch identity before rebinding the rows below,
      // so the server can atomically terminal that batch when it persists the
      // replacement. A partially-stamped set is unsafe: creating a second
      // Review would otherwise leave the old token and Live Activity active.
      const previousIdentities = pendingToolsCalling.map((toolPayload) => ({
        batchId: toolPayload.intervention?.batchId,
        operationId: toolPayload.intervention?.operationId,
        toolCallId: toolPayload.id,
      }));
      const hasPreviousDurableIdentity = previousIdentities.some(
        ({ batchId, operationId: previousOperationId }) => batchId || previousOperationId,
      );
      if (instructionSupersedes) {
        const pendingToolCallIds = pendingToolsCalling.map(({ id }) => id);
        if (
          instructionSupersedes.toolCallIds.length !== pendingToolCallIds.length ||
          new Set(instructionSupersedes.toolCallIds).size !== pendingToolCallIds.length ||
          instructionSupersedes.toolCallIds.some((id) => !pendingToolCallIds.includes(id))
        ) {
          throw new Error(
            `[request_human_approve] Supersession does not match rebound members (op=${operationId})`,
          );
        }
        supersedes = instructionSupersedes;
      } else if (hasPreviousDurableIdentity) {
        const firstPrevious = previousIdentities[0];
        if (
          !firstPrevious.batchId ||
          !firstPrevious.operationId ||
          previousIdentities.some(
            (identity) =>
              !identity.batchId ||
              !identity.operationId ||
              identity.batchId !== firstPrevious.batchId ||
              identity.operationId !== firstPrevious.operationId,
          )
        ) {
          throw new Error(
            `[request_human_approve] Cannot rebind a partial or mixed durable intervention batch (op=${operationId})`,
          );
        }
        supersedes = {
          batchId: firstPrevious.batchId,
          operationId: firstPrevious.operationId,
          toolCallIds: previousIdentities.map(({ toolCallId }) => toolCallId),
        };
      }

      // Resumption mode: tool messages already exist. Look them up by
      // tool_call_id so we can still ship the mapping to the client.
      let dbMessages: Awaited<ReturnType<typeof transports.messages.query>> = [];
      try {
        dbMessages = await transports.messages.query({
          agentId,
          // Group runs need groupId or the query returns no group messages, so
          // the existing tool-message lookup on resume would find nothing.
          groupId,
          threadId,
          topicId,
        });
      } catch {
        // The explicit missing-row guard below keeps the parked batch closed.
      }
      for (const toolPayload of pendingToolsCalling) {
        const existing = dbMessages.find(
          (m: any) => m.role === 'tool' && m.tool_call_id === toolPayload.id,
        );
        if (!existing) {
          throw new Error(
            `[request_human_approve] Missing durable tool message for resumed intervention ${toolPayload.id}`,
          );
        }
        toolMessageIds[toolPayload.id] = existing.id;
      }

      if (!approvalAssistantMessageId) {
        throw new Error(
          `[request_human_approve] Missing assistant owner for resumed intervention (op=${operationId})`,
        );
      }

      // A partial resolution starts a new runtime operation and can park the
      // unresolved siblings again. Rebind those durable rows to the new parked
      // owner and sealed batch; retaining the previous operation id would let
      // Stop target a stale run and make notification durability checks fail.
      const batchId = `${operationId}:${stepIndex}:${approvalAssistantMessageId}`;
      await Promise.all(
        pendingToolsCalling.map((toolPayload, itemIndex) =>
          transports.messages.updateToolIntervention(toolMessageIds[toolPayload.id], {
            batchId,
            itemIndex,
            operationId,
            status: 'pending',
            stepIndex,
          }),
        ),
      );
    } else {
      // Resolve the assistant message that owns these tool calls.
      //
      // `parentMessageId` names it explicitly and is authoritative. Scanning
      // `state.messages` for the last `role: 'assistant'` — the original
      // approach, kept below only as a legacy fallback — silently picks the
      // WRONG turn once an op crosses a step boundary:
      //
      // 1. `callLlmFinalizer` pushes this turn's assistant onto `state.messages`
      //    as a plain `role: 'assistant'`, so in-process the scan is correct.
      // 2. `AgentStateManager.serializeStateForPersist` strips `messages` before
      //    persisting (Upstash 10MB cap), so the next step starts without them.
      // 3. `AgentRuntimeService.rehydrateStateMessagesFromDB` reloads them via
      //    `parse()`, which folds an assistant carrying tool calls into an
      //    `assistantGroup` virtual message — same `id`, different `role`.
      //
      // The scan skips that `assistantGroup` and lands on the previous turn's
      // plain assistant. The tool row then persists under a parent whose
      // `tools[]` doesn't list it, and `MessageCollector.collectToolMessages`
      // (which pairs a tool to its assistant on `parentId` + `tool_call_id`)
      // can't match it from either side — the UI renders it as a top-level
      // `inspector.orphanedToolCall`. Only interventions hit this: plain tool
      // calls carry the parent through `call_tool` and were never affected.
      let parentAssistant: { groupId?: string | null; id: string } | undefined = parentMessageId
        ? {
            // Post-rehydration the owner is present as an `assistantGroup`,
            // which keeps the source assistant's fields (incl. groupId), so
            // this lookup still resolves. `groupId` from the operation takes
            // precedence anyway; this only backfills legacy callers.
            groupId: (state.messages ?? []).find((m: any) => m.id === parentMessageId)?.groupId,
            id: parentMessageId,
          }
        : undefined;

      // Legacy fallback for instructions emitted without `parentMessageId`.
      // Accurate only within a single step — see the step-boundary case above.
      parentAssistant ??= (state.messages ?? [])
        .slice()
        .reverse()
        .find((m: any) => m.role === 'assistant' && m.id) as
        { groupId?: string | null; id: string } | undefined;

      if (!parentAssistant) {
        try {
          const dbMessages = await transports.messages.query({
            agentId,
            // Group runs need groupId or the query returns no group messages, so
            // the parent-assistant fallback lookup would find nothing.
            groupId,
            threadId,
            topicId,
          });
          parentAssistant = dbMessages
            .slice()
            .reverse()
            .find((m: any) => m.role === 'assistant');
        } catch {
          // fall through to the missing-parent guard below
        }
      }

      if (!parentAssistant) {
        throw new Error(
          `[request_human_approve] No assistant message found for intervention (op=${operationId})`,
        );
      }

      if (!agentId) {
        throw new Error(
          `[request_human_approve] Missing agentId for pending tool messages (op=${operationId})`,
        );
      }

      approvalAssistantMessageId = parentAssistant.id;
      const batchId = `${operationId}:${stepIndex}:${parentAssistant.id}`;
      for (const [itemIndex, toolPayload] of pendingToolsCalling.entries()) {
        const toolMessage = await transports.messages.createToolMessage({
          agentId,
          content: '',
          groupId: groupId ?? parentAssistant.groupId ?? undefined,
          parentId: parentAssistant.id,
          plugin: toolPayload as any,
          pluginIntervention: {
            batchId,
            itemIndex,
            operationId,
            status: 'pending',
            stepIndex,
          },
          role: 'tool',
          threadId,
          tool_call_id: toolPayload.id,
          topicId,
        });

        toolMessageIds[toolPayload.id] = toolMessage.id;

        // Intentionally DO NOT push the empty placeholder into
        // newState.messages. When the approval resumes, the `call_tool`
        // executor (skip-create branch) appends the resolved tool message to
        // state.messages itself. Pushing a placeholder here produced two
        // entries for the same tool_call_id.
      }
    }

    newState.pendingToolMessageIds = toolMessageIds;
    if (approvalAssistantMessageId) {
      newState.pendingApprovalBatch = {
        assistantMessageId: approvalAssistantMessageId,
        id: `${operationId}:${stepIndex}:${approvalAssistantMessageId}`,
        sealed: true,
        stepIndex,
        ...(supersedes && { supersedes }),
      };
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
