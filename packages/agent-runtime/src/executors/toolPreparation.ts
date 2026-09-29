import type { ChatToolPayload } from '@lobechat/types';
import { isEqual } from 'es-toolkit';

import type { AgentRuntimeHost, ToolCallPreparation, ToolRunContext } from '../transport';
import type { AgentRuntimeContext, AgentState, RuntimeConfig } from '../types';
import { extractActivatedSkillsFromMessages, extractTodosFromMessages } from '../utils';
import { selectToolManifestMap, selectToolSourceMap } from '../utils/operationToolSet';

const toolNameOf = (tool: ChatToolPayload) => `${tool.identifier}/${tool.apiName}`;

export const resolveToolSource = (state: AgentState, tool: ChatToolPayload): string | undefined =>
  selectToolSourceMap(state)[tool.identifier];

const parseToolArgs = (tool: ChatToolPayload): Record<string, unknown> => {
  try {
    if (typeof tool.arguments === 'string') {
      const parsed = JSON.parse(tool.arguments) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }

    return tool.arguments && typeof tool.arguments === 'object'
      ? (tool.arguments as Record<string, unknown>)
      : {};
  } catch {
    // Execution still receives the raw arguments; this preview is only for hooks.
    return {};
  }
};

export const buildEffectiveManifestMap = (state: AgentState): Record<string, any> => ({
  ...selectToolManifestMap(state),
  ...Object.fromEntries(
    (state.activatedStepTools ?? [])
      .filter((activation) => activation.manifest)
      .map((activation) => [activation.id, activation.manifest!]),
  ),
});

const resolveCallIndex = (state: AgentState, toolName: string) => {
  const existingToolStats = state.usage?.tools?.byTool?.find((tool) => tool.name === toolName);
  return (existingToolStats?.calls ?? 0) + 1;
};

export const createRunContext = ({
  host,
  mode,
  parentMessageId,
  reuseExistingMessage,
  state,
  stepContext,
  tool,
  toolMessageId,
}: {
  host: AgentRuntimeHost;
  mode: ToolRunContext['mode'];
  parentMessageId: string;
  reuseExistingMessage?: boolean;
  state: AgentState;
  stepContext?: AgentRuntimeContext['stepContext'];
  tool: ChatToolPayload;
  toolMessageId?: string;
}): ToolRunContext => {
  const toolName = toolNameOf(tool);
  const toolSource = resolveToolSource(state, tool);
  const agentConfig = state.world?.agent as
    { chatConfig?: { toolResultMaxLength?: number } } | undefined;

  return {
    abortSignal: host.operation.abortSignal,
    activatedSkills: extractActivatedSkillsFromMessages(state.messages),
    agentId: host.operation.agentId ?? state.origin?.agentId,
    assistantMessageId: parentMessageId,
    callIndex: resolveCallIndex(state, toolName),
    // Todo state is reconstructed from message history for the same reason the
    // prompt side does it (`serverCallLlmContextBuilder`): the plan document is
    // a best-effort mirror that only exists once `createPlan` has run, so the
    // tool-execution side must not treat it as the source of truth.
    currentTodos: extractTodosFromMessages(state.messages)?.items,
    effectiveManifestMap: buildEffectiveManifestMap(state),
    groupId: host.operation.groupId ?? state.origin?.groupId,
    messageId: state.origin?.sourceMessageId,
    mode,
    operationId: host.operation.operationId,
    parentMessageId,
    originalArgs: structuredClone(state.toolPreparations?.[tool.id]?.originalArgs),
    parsedArgs: parseToolArgs(tool),
    reuseExistingMessage,
    state,
    stepIndex: host.operation.stepIndex,
    stepContext,
    threadId: host.operation.threadId ?? state.origin?.threadId,
    toolMessageId,
    toolName,
    toolResultMaxLength: agentConfig?.chatConfig?.toolResultMaxLength,
    toolSource,
    topicId: host.operation.topicId ?? state.origin?.topicId,
    workspaceId: state.origin?.workspaceId ?? host.operation.workspaceId,
  };
};

/** Shared by the decision boundary and direct single/batch executors. No mock or tool IO. */
export async function prepareToolCalls(
  host: AgentRuntimeHost,
  state: AgentState,
  calls: ChatToolPayload[],
  parentMessageId: string,
  stepContext?: AgentRuntimeContext['stepContext'],
): Promise<void> {
  if (!host.transports.tools?.prepare) return;
  // Providers can reuse native ids in a later assistant turn.
  if (state.toolPreparationParentId !== parentMessageId) {
    state.toolPreparations = {};
    state.toolPreparationParentId = parentMessageId;
  }
  state.toolPreparations ??= {};
  for (const tool of calls) {
    if (state.toolPreparations[tool.id]) {
      const effective = state.toolPreparations[tool.id].effectiveArgs;
      if (effective) tool.arguments = JSON.stringify(effective);
      continue;
    }
    const context = createRunContext({
      host,
      mode: calls.length > 1 ? 'batch' : 'single',
      parentMessageId,
      state,
      stepContext,
      tool,
    });
    const signal = context.abortSignal;
    const cancelled: ToolCallPreparation = {
      originalArgs: context.originalArgs ?? context.parsedArgs,
      status: 'cancelled',
    };
    const preparation = signal?.aborted
      ? cancelled
      : await new Promise<ToolCallPreparation>((resolve, reject) => {
          const onAbort = () => resolve(cancelled);
          signal?.addEventListener('abort', onAbort, { once: true });
          Promise.resolve()
            .then(() =>
              signal?.aborted ? cancelled : host.transports.tools!.prepare!(tool, context),
            )
            .then(resolve, reject)
            .finally(() => signal?.removeEventListener('abort', onAbort));
          if (signal?.aborted) onAbort();
        });
    state.toolPreparations[tool.id] = signal?.aborted ? cancelled : preparation;
    if (preparation.effectiveArgs && !signal?.aborted) {
      tool.arguments = JSON.stringify(preparation.effectiveArgs);
    }
    if (
      host.operation.abortSignal?.aborted ||
      state.toolPreparations[tool.id].status === 'cancelled'
    ) {
      state.status = 'interrupted';
      break;
    }
  }
}

export const createToolPreparation =
  (host: AgentRuntimeHost): NonNullable<RuntimeConfig['prepareTools']> =>
  async (context, state) => {
    if (state.status === 'interrupted') return;
    if (context.phase !== 'llm_result' && context.phase !== 'human_approved_tool') return;
    const payload = context.payload as {
      toolsCalling?: ChatToolPayload[];
      approvedToolCall?: ChatToolPayload;
      approvedToolCalls?: ChatToolPayload[];
      parentMessageId: string;
      toolMessageIds?: Record<string, string>;
      invalidatedApprovalIds?: string[];
      approvalParentMessageId?: string;
      approvalSourceBatch?: { batchId: string; operationId: string };
      pendingApprovalSiblings?: ChatToolPayload[];
    };
    const calls =
      payload.toolsCalling ??
      payload.approvedToolCalls ??
      (payload.approvedToolCall ? [payload.approvedToolCall] : []);
    const approvedArgs = new Map(calls.map((call) => [call.id, parseToolArgs(call)]));
    const priorContexts = new Map<string, ToolCallPreparation['additionalContexts']>();
    if (context.phase === 'human_approved_tool') {
      const rows = await host.transports.messages.query({
        agentId: state.origin?.agentId,
        groupId: state.origin?.groupId,
        threadId: state.origin?.threadId,
        topicId: state.origin?.topicId,
      });
      for (const call of calls) {
        const row = rows.find(
          (row) =>
            row.role === 'tool' &&
            row.tool_call_id === call.id &&
            (row.parentId === payload.parentMessageId ||
              row.id === payload.parentMessageId ||
              row.id === payload.toolMessageIds?.[call.id]),
        );
        const previous = row?.pluginState?.hookPreparation as ToolCallPreparation | undefined;
        const retained =
          previous ??
          (state.toolPreparationParentId === payload.parentMessageId
            ? state.toolPreparations?.[call.id]
            : undefined);
        const reviewedArguments = row?.pluginIntervention?.approvedArguments;
        if (reviewedArguments !== undefined) {
          approvedArgs.set(call.id, parseToolArgs({ ...call, arguments: reviewedArguments }));
        } else if (retained?.approvalArgs) {
          approvedArgs.set(call.id, retained.approvalArgs);
        } else if (row?.plugin?.arguments) {
          approvedArgs.set(call.id, parseToolArgs({ ...call, arguments: row.plugin.arguments }));
        }
        priorContexts.set(call.id, retained?.additionalContexts);
        if (retained) call.arguments = JSON.stringify(retained.originalArgs);
        if (row) {
          if (row.pluginIntervention?.batchId && row.pluginIntervention.operationId) {
            payload.approvalSourceBatch = {
              batchId: row.pluginIntervention.batchId,
              operationId: row.pluginIntervention.operationId,
            };
          }
          payload.approvalParentMessageId = row.parentId ?? undefined;
          payload.toolMessageIds ??= {};
          payload.toolMessageIds[call.id] = row.id;
        }
        delete state.toolPreparations?.[call.id];
      }
      payload.pendingApprovalSiblings = rows
        .filter(
          (row) =>
            row.role === 'tool' &&
            row.parentId === payload.approvalParentMessageId &&
            row.pluginIntervention?.status === 'pending' &&
            row.plugin &&
            row.tool_call_id &&
            !calls.some(({ id }) => id === row.tool_call_id),
        )
        .map((row) => ({
          ...row.plugin!,
          id: row.tool_call_id!,
          intervention: row.pluginIntervention,
        }));
    }
    await prepareToolCalls(
      host,
      state,
      calls,
      payload.approvalParentMessageId ?? payload.parentMessageId,
      context.stepContext,
    );
    if (context.phase === 'human_approved_tool' && !host.operation.abortSignal?.aborted) {
      payload.invalidatedApprovalIds = calls
        .filter((call) => !isEqual(approvedArgs.get(call.id), parseToolArgs(call)))
        .map(({ id }) => id);
      for (const call of calls) {
        const id = payload.toolMessageIds?.[call.id];
        const preparation = state.toolPreparations?.[call.id];
        if (preparation) preparation.approvalArgs = structuredClone(approvedArgs.get(call.id));
        if (preparation && priorContexts.get(call.id)?.length) {
          const fragments = new Map(
            (priorContexts.get(call.id) ?? []).map((fragment) => [fragment.hookId, fragment]),
          );
          for (const fragment of preparation.additionalContexts ?? [])
            fragments.set(fragment.hookId, fragment);
          preparation.additionalContexts = [...fragments.values()];
        }
        if (id && preparation)
          await host.transports.messages.updateToolCall?.(id, call.arguments, preparation);
      }
    }
  };
