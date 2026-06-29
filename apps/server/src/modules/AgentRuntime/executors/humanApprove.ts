import {
  type AgentEvent,
  type AgentInstruction,
  type InstructionExecutor,
} from '@lobechat/agent-runtime';

import { type RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';

export const requestHumanApprove =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { pendingToolsCalling, skipCreateToolMessage } = instruction as Extract<
      AgentInstruction,
      { type: 'request_human_approve' }
    >;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Requesting human approval for %O', operationId, stepIndex, pendingToolsCalling);

    // Publish human approval request event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        pendingToolsCalling,
        phase: 'human_approval',
        requiresApproval: true,
      },
      stepIndex,
      type: 'step_start',
    });

    if (ctx.hookDispatcher) {
      ctx.hookDispatcher
        .dispatch(
          operationId,
          'beforeHumanIntervention',
          {
            operationId,
            pendingTools: pendingToolsCalling.map((t: any) => ({
              apiName: t.apiName,
              identifier: t.identifier,
            })),
            stepIndex,
            userId: ctx.userId,
          },
          state.metadata?._hooks,
        )
        .catch(() => {});
    }

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'waiting_for_human';
    newState.pendingToolsCalling = pendingToolsCalling;

    // Map of toolCallId -> toolMessageId, populated either by creating fresh
    // pending tool messages or (in resumption mode) by looking up existing ones.
    const toolMessageIds: Record<string, string> = {};

    if (skipCreateToolMessage) {
      // Resumption mode: tool messages already exist in DB. Look them up by
      // tool_call_id so we can still ship the mapping to the client.
      log('[%s:%d] Resuming with existing tool messages', operationId, stepIndex);
      try {
        const dbMessages = await ctx.messageModel.query({
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
      } catch (error) {
        console.error(
          '[%s:%d] Failed to look up existing tool messages: %O',
          operationId,
          stepIndex,
          error,
        );
      }
    } else {
      // Find parent assistant message. Prefer state.messages (already in
      // memory from call_llm); fall back to DB query if the runtime has been
      // rehydrated without recent messages.
      let parentAssistantId: string | undefined = (state.messages ?? [])
        .slice()
        .reverse()
        .find((m: any) => m.role === 'assistant' && m.id)?.id;

      if (!parentAssistantId) {
        try {
          const dbMessages = await ctx.messageModel.query({
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
        } catch (error) {
          console.error(
            '[%s:%d] Failed to query DB for parent assistant: %O',
            operationId,
            stepIndex,
            error,
          );
        }
      }

      if (!parentAssistantId) {
        throw new Error(
          `[request_human_approve] No assistant message found as parent for pending tool messages (op=${operationId})`,
        );
      }

      for (const toolPayload of pendingToolsCalling) {
        const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
        try {
          const toolMessage = await ctx.messageModel.create({
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
          // executor (skip-create branch) appends the resolved tool message
          // to state.messages itself. Pushing a placeholder here produced
          // two entries for the same tool_call_id — see review P2.

          log(
            '[%s:%d] Created pending tool message %s for %s',
            operationId,
            stepIndex,
            toolMessage.id,
            toolName,
          );
        } catch (error) {
          console.error(
            '[%s:%d] Failed to create pending tool message for %s: %O',
            operationId,
            stepIndex,
            toolName,
            error,
          );
          throw error;
        }
      }
    }

    // Notify frontend to display approval UI through streaming system.
    // `toolMessageIds` is a new optional field; legacy consumers ignore it.
    await streamManager.publishStreamChunk(operationId, stepIndex, {
      chunkType: 'tools_calling',
      toolMessageIds,
      toolsCalling: pendingToolsCalling as any,
    } as any);

    const events: AgentEvent[] = [
      {
        operationId,
        pendingToolsCalling,
        type: 'human_approve_required',
      },
      {
        // Note: pendingToolsCalling is ChatToolPayload[] but AgentEventToolPending expects ToolsCalling[]
        // This is intentional for display purposes in the frontend
        toolCalls: pendingToolsCalling as any,
        type: 'tool_pending',
      },
    ];

    log('Human approval requested for operation %s:%d', operationId, stepIndex);

    return {
      events,
      newState,
      // Do not provide nextContext as it requires waiting for human intervention
    };
  };
