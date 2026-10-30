import type {
  MainAgentIntent,
  SubagentIntent,
  ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import debug from 'debug';

import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';

import { heteroProvenance } from '../heteroProvenance';
import { applyToolIntervention } from './intervention';
import type { HeterogeneousPersistenceHandlerDeps, OperationState } from './types';

const log = debug('lobe-server:hetero-agent:persistence');

export async function applyMainIntent(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  intent: MainAgentIntent,
  stepIndex: number,
) {
  switch (intent.kind) {
    case 'createAssistant': {
      const createMetadata: Record<string, any> = {
        ...heteroProvenance(state, intent.mainMessageId),
        operationId: state.operationId,
      };
      if (intent.signal) createMetadata.signal = intent.signal;
      // Persist the turn's CC message.id so a cold replica can recover
      // `currentMainMessageId` (via refreshMainStateFromDb) and dedupe a
      // replayed `newStep` instead of forking a duplicate + empty shell.
      if (intent.mainMessageId) createMetadata.mainMessageId = intent.mainMessageId;
      await deps.messageModel.create(
        {
          agentId: intent.agentId ?? undefined,
          content: '',
          ...(Object.keys(createMetadata).length > 0 ? { metadata: createMetadata } : {}),
          model: intent.model,
          parentId: intent.parentId,
          provider: intent.provider,
          role: 'assistant',
          threadId: state.threadId,
          topicId: intent.topicId ?? state.topicId,
        } as any,
        intent.messageId,
      );

      if (deps.topicModel.updateRunningOperationAssistantMessage) {
        await deps.topicModel.updateRunningOperationAssistantMessage(
          state.topicId,
          state.operationId,
          intent.messageId,
        );
      } else {
        await deps.topicModel.updateMetadata(state.topicId, {
          heteroCurrentMsgId: { msgId: intent.messageId, operationId: state.operationId },
        });
      }
      return;
    }

    case 'persistAssistant': {
      const update: Record<string, any> = {};
      if (intent.content !== undefined) update.content = intent.content;
      if (intent.reasoning !== undefined) update.reasoning = { content: intent.reasoning };
      if (intent.model) update.model = intent.model;
      if (intent.provider) update.provider = intent.provider;
      update.metadata = {
        ...intent.metadata,
        operationId: state.operationId,
      };
      if (Object.keys(update).length > 0) {
        await deps.messageModel.update(intent.messageId, update);
      }
      return;
    }

    // Token-level live updates are renderer-only. The server persists durable
    // snapshots via persistAssistant / persistToolBatch / flushBatchContent.
    case 'streamContent': {
      return;
    }

    case 'persistToolBatch': {
      const buildUpdate = (withResult: boolean) =>
        buildToolBatchUpdate(intent.tools, {
          content: intent.content,
          reasoning: intent.reasoning,
          withResult,
        });

      // Phase 1: assistant.tools[] without result_msg_id.
      await deps.messageModel.update(intent.assistantMessageId, buildUpdate(false));

      // Phase 2: create new tool rows with reducer-preallocated ids.
      for (const tool of intent.tools) {
        if (!tool.isNew) continue;
        const toolMetadata = heteroProvenance(state, state.main.currentMainMessageId);
        await deps.messageModel.create(
          {
            agentId: state.agentId ?? undefined,
            content: '',
            ...(Object.keys(toolMetadata).length > 0 ? { metadata: toolMetadata } : {}),
            parentId: intent.assistantMessageId,
            plugin: {
              apiName: tool.payload.apiName,
              arguments: tool.payload.arguments,
              identifier: tool.payload.identifier,
              type: tool.payload.type,
            },
            role: 'tool',
            threadId: state.threadId,
            tool_call_id: tool.payload.id,
            topicId: state.topicId,
          } as any,
          tool.toolMessageId,
        );
        state.toolMsgIdByCallId.set(tool.payload.id, tool.toolMessageId);
      }

      // Phase 3: backfill result_msg_id.
      await deps.messageModel.update(intent.assistantMessageId, buildUpdate(true));
      return;
    }

    case 'resolveToolResult': {
      await applyToolResult(deps, state, intent);
      return;
    }

    case 'updateToolState': {
      await applyToolState(deps, state, intent);
      return;
    }

    case 'setToolIntervention': {
      await applyToolIntervention(deps, state, intent, stepIndex);
      return;
    }

    case 'recordUsage': {
      const update: Record<string, any> = {};
      if (intent.usage !== undefined) {
        // This overwrites the row's metadata wholesale, so re-stamp the
        // provenance the createAssistant write put there, or usage would wipe it.
        update.metadata = {
          ...state.main.turnMetadata,
          ...heteroProvenance(state, state.main.currentMainMessageId),
          operationId: state.operationId,
          usage: intent.usage,
        };
      }
      if (intent.model) update.model = intent.model;
      if (intent.provider) update.provider = intent.provider;
      if (Object.keys(update).length > 0) {
        await deps.messageModel.update(intent.messageId, update);
      }
      return;
    }

    case 'setError': {
      // Normalize the CLI agent's wire error data through the SAME canonical
      // formatter the in-process runtime uses, so a hetero error is classified
      // (attribution/category/retryable) identically and the renderer never sees
      // a second, hetero-only error shape.
      const update: Record<string, any> = { error: formatErrorForState(intent.errorData) };
      if (intent.clearContent) update.content = '';
      await deps.messageModel.update(intent.messageId, update);
      return;
    }
  }
}

async function applyToolResult(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  intent: {
    content: string;
    isError: boolean;
    pluginState?: Record<string, any>;
    toolCallId: string;
  },
) {
  const toolMsgId = state.toolMsgIdByCallId.get(intent.toolCallId);
  if (!toolMsgId) {
    log('tool_result for unknown toolCallId=%s op=%s', intent.toolCallId, state.operationId);
    return;
  }

  const result = await deps.messageModel.updateToolMessage(toolMsgId, {
    content: intent.content,
    pluginError: intent.isError ? { message: intent.content } : undefined,
    pluginState: intent.pluginState,
  });
  if (!result.success) {
    throw new Error(`Failed to persist tool_result for message ${toolMsgId}`);
  }
}

async function applyToolState(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  intent: {
    pluginState: Record<string, unknown>;
    snapshotSeq: number;
    toolCallId: string;
  },
): Promise<void> {
  const lastApplied = state.lastAppliedToolStateSeqByCallId.get(intent.toolCallId) ?? 0;
  if (intent.snapshotSeq <= lastApplied) return;

  const toolMsgId = state.toolMsgIdByCallId.get(intent.toolCallId);
  if (!toolMsgId) {
    throw new Error(
      `tool_state for unknown toolCallId=${intent.toolCallId} op=${state.operationId}`,
    );
  }

  const result = await deps.messageModel.updateToolMessage(toolMsgId, {
    heterogeneousToolState: {
      operationId: state.operationId,
      snapshotSeq: intent.snapshotSeq,
    },
    pluginState: intent.pluginState,
  });
  if (!result.success) {
    throw new Error(`Failed to persist tool_state for message ${toolMsgId}`);
  }

  state.lastAppliedToolStateSeqByCallId.set(
    intent.toolCallId,
    result.snapshotSeq ?? intent.snapshotSeq,
  );
}

function buildToolBatchUpdate(
  tools: Array<{ payload: ToolCallPayload; toolMessageId: string }>,
  options: { content?: string; reasoning?: string; withResult: boolean },
): Record<string, any> {
  const update: Record<string, any> = {
    tools: tools.map(({ payload, toolMessageId }) =>
      options.withResult ? { ...payload, result_msg_id: toolMessageId } : { ...payload },
    ),
  };
  if (options.content) update.content = options.content;
  if (options.reasoning) update.reasoning = { content: options.reasoning };
  return update;
}

export async function applySubagentIntent(
  deps: HeterogeneousPersistenceHandlerDeps,
  state: OperationState,
  intent: SubagentIntent,
) {
  switch (intent.kind) {
    case 'createThread': {
      await deps.threadModel.create({
        id: intent.threadId,
        metadata: {
          // Stamp the owning hetero operation so `refreshSubagentRunsFromDb`
          // only rehydrates threads from THIS run — never a stale Processing
          // thread a prior crashed/cancelled run left on the same topic.
          operationId: state.operationId,
          sourceToolCallId: intent.sourceToolCallId,
          startedAt: new Date().toISOString(),
          subagentType: intent.subagentType,
        },
        sourceMessageId: intent.sourceMessageId,
        status: ThreadStatus.Processing,
        title: intent.title,
        topicId: intent.topicId ?? state.topicId,
        type: ThreadType.Isolation,
      } as any);
      return;
    }

    case 'createMessage': {
      const subMetadata: Record<string, any> = {
        ...heteroProvenance(state, intent.subagentMessageId),
      };
      // Persist the turn's CC message.id so a cold replica can recover
      // `currentSubagentMessageId` (via buildSubagentSnapshot) and avoid
      // a spurious turn boundary that fragments one CC turn into multiple
      // in-thread assistant rows + empty shells.
      if (intent.subagentMessageId) subMetadata.subagentMessageId = intent.subagentMessageId;
      await deps.messageModel.create(
        {
          agentId: intent.agentId ?? undefined,
          content: intent.content,
          ...(Object.keys(subMetadata).length > 0 ? { metadata: subMetadata } : {}),
          parentId: intent.parentId,
          role: intent.role,
          threadId: intent.threadId,
          topicId: intent.topicId ?? state.topicId,
        } as any,
        intent.messageId,
      );
      return;
    }

    // Live in-memory UI updates have no server surface; durable writes land
    // via persistContent / persistToolBatch.
    case 'streamContent': {
      return;
    }

    case 'resolveToolResult': {
      await applyToolResult(deps, state, intent);
      return;
    }

    case 'updateToolState': {
      await applyToolState(deps, state, intent);
      return;
    }

    case 'persistContent': {
      const update: Record<string, any> = {};
      if (intent.content) update.content = intent.content;
      if (intent.reasoning) update.reasoning = { content: intent.reasoning };
      if (Object.keys(update).length > 0) {
        await deps.messageModel.update(intent.messageId, update);
      }
      return;
    }

    case 'persistToolBatch': {
      const buildUpdate = (withResult: boolean) =>
        buildToolBatchUpdate(intent.tools, {
          content: intent.content,
          reasoning: intent.reasoning,
          withResult,
        });

      // Phase 1: pre-register assistant.tools[] (no result_msg_id yet).
      await deps.messageModel.update(intent.assistantMessageId, buildUpdate(false));

      // Phase 2: create rows for new tools with their pre-allocated ids and
      // register them in the global tool-message map for tool_result lookup.
      for (const t of intent.tools) {
        if (!t.isNew) continue;
        const subToolMetadata = heteroProvenance(state, intent.subagentMessageId);
        await deps.messageModel.create(
          {
            agentId: state.agentId ?? undefined,
            content: '',
            ...(Object.keys(subToolMetadata).length > 0 ? { metadata: subToolMetadata } : {}),
            parentId: intent.assistantMessageId,
            plugin: {
              apiName: t.payload.apiName,
              arguments: t.payload.arguments,
              identifier: t.payload.identifier,
              type: t.payload.type,
            },
            role: 'tool',
            threadId: intent.threadId,
            tool_call_id: t.payload.id,
            topicId: state.topicId,
          } as any,
          t.toolMessageId,
        );
        state.toolMsgIdByCallId.set(t.payload.id, t.toolMessageId);
      }

      // Phase 3: backfill result_msg_id on assistant.tools[].
      await deps.messageModel.update(intent.assistantMessageId, buildUpdate(true));
      return;
    }

    case 'recordUsage': {
      await deps.messageModel.update(intent.messageId, {
        // Wholesale metadata overwrite — re-stamp the session + message
        // provenance the createMessage write put there, or usage would wipe it.
        metadata: {
          ...heteroProvenance(state, intent.subagentMessageId),
          usage: intent.usage as any,
        },
        ...(intent.model && { model: intent.model }),
        ...(intent.provider && { provider: intent.provider }),
      });
      return;
    }

    case 'finalizeThread': {
      await deps.threadModel.update(intent.threadId, { status: ThreadStatus.Active });
      return;
    }

    case 'reopenThread': {
      await deps.threadModel.update(intent.threadId, { status: ThreadStatus.Processing });
      return;
    }
  }
}
