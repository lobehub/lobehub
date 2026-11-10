import type { AgentState } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';

import type { FunctionCallOutputItem, OutputItem } from '../types/responses.type';

/**
 * A request the caller sent wrong: an output for a call nobody made, or a call
 * left without one. Surfaces as a failed response rather than a silent re-run.
 */
export class ClientToolResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientToolResumeError';
  }
}

/**
 * The assistant message that issued `callId`, which its result row hangs off.
 * A parked state is usually saved without its messages; the last model call's
 * assistant (`workAssistantMessageId`) is then the one that made the calls.
 */
const findCallingAssistantId = (state: AgentState, callId: string): string | undefined => {
  for (const message of [...(state.messages ?? [])].reverse()) {
    if (message?.role !== 'assistant') continue;
    const calls = [...(message.tool_calls ?? []), ...(message.tools ?? [])];
    if (calls.some((call: { id?: string }) => call?.id === callId)) return message.id;
  }
  return state.metadata?.workAssistantMessageId;
};

interface ResumeParams {
  agentRuntimeService: AgentRuntimeService;
  db: LobeChatDatabase;
  outputs: FunctionCallOutputItem[];
  topicId: string;
  userId: string;
  workspaceId?: string;
}

/** Function tools the API caller supplied and runs itself (`lobe-client-fn____<name>`). */
const CALLER_TOOL_IDENTIFIER = 'lobe-client-fn';
const isCallerTool = (tool: ChatToolPayload) => tool.identifier === CALLER_TOOL_IDENTIFIER;

/** Hand a claimed park back, so whatever delivers the remaining results can resume it. */
const releaseClaim = (db: LobeChatDatabase, userId: string, operationId: string) =>
  db
    .update(agentOperations)
    .set({ status: 'waiting_for_async_tool' })
    .where(
      and(
        eq(agentOperations.id, operationId),
        eq(agentOperations.userId, userId),
        eq(agentOperations.status, 'running'),
      ),
    );

export interface ParkedClientToolsResume {
  /** The caller's calls these outputs answered. */
  callIds: string[];
  /**
   * The outputs are saved, but server-side tools from the same batch are still
   * running; their completion resumes the run, not this request.
   */
  held?: boolean;
  operationId: string;
}

/**
 * Hand the caller's `function_call_output` items to the run parked on this
 * topic and continue that same run, the way an OpenResponses client expects
 * `previous_response_id` + tool outputs to behave.
 *
 * The run parked itself (`waiting_for_async_tool`) when the model called one
 * of the caller's function tools, possibly in the same batch as server-side
 * deferred tools such as a sub-agent. Nothing else will ever deliver the
 * caller's results, and the run keeps the topic's `runningOperation` marker: a
 * new run on the topic is refused as busy, and the gateway's inactivity
 * watchdog eventually writes the parked turn off as abandoned.
 *
 * Claims the park, writes each output as the tool result of its call, and
 * returns the operation to resume — or `held` when other tools of the batch are
 * still out. Returns `undefined` when nothing on the topic waits on the
 * caller, so the caller can start a new run instead.
 */
export const resumeParkedClientTools = async ({
  agentRuntimeService,
  db,
  outputs,
  topicId,
  userId,
  workspaceId,
}: ResumeParams): Promise<ParkedClientToolsResume | undefined> => {
  const topic = await new TopicModel(db, userId, workspaceId).findById(topicId);
  const operationId = topic?.metadata?.runningOperation?.operationId;
  if (!operationId) return;

  const operationModel = new AgentOperationModel(db, userId, workspaceId);
  const operation = await operationModel.findById(operationId);
  if (operation?.status !== 'waiting_for_async_tool') return;

  const state = await agentRuntimeService.getCoordinator().loadAgentState(operationId);
  if (state?.status !== 'waiting_for_async_tool') return;

  const pending = (state.pendingToolsCalling ?? []) as ChatToolPayload[];
  const callerCalls = pending.filter(isCallerTool);
  if (callerCalls.length === 0) return;

  const outputByCallId = new Map(outputs.map((item) => [item.call_id, item.output]));
  for (const item of outputs) {
    if (!callerCalls.some((tool) => tool.id === item.call_id))
      throw new ClientToolResumeError(
        `No tool call found for function call output with call_id ${item.call_id}.`,
      );
  }
  for (const tool of callerCalls) {
    if (!outputByCallId.has(tool.id))
      throw new ClientToolResumeError(`No tool output found for function call ${tool.id}.`);
  }

  // Claim before writing: only one delivery may record results, so a racing
  // retry cannot add duplicate rows or replace the outputs the run resumes on.
  if (!(await operationModel.tryResumeFromAsyncTool(operationId)))
    throw new ClientToolResumeError('These function call outputs were already submitted.');

  const callIds = callerCalls.map((tool) => tool.id);
  try {
    const messageModel = new MessageModel(db, userId, workspaceId);
    const agentId = state.origin?.agentId ?? operation.agentId ?? undefined;
    for (const tool of callerCalls) {
      const content = outputByCallId.get(tool.id)!;
      const parentId = findCallingAssistantId(state, tool.id);
      const existingId = await messageModel.findToolMessageIdByToolCallId(tool.id, parentId);
      if (existingId) {
        await messageModel.updateToolMessage(existingId, { content });
        continue;
      }
      await messageModel.create({
        agentId,
        content,
        groupId: state.origin?.groupId ?? undefined,
        parentId,
        plugin: tool as any,
        role: 'tool',
        threadId: state.origin?.threadId ?? undefined,
        tool_call_id: tool.id,
        topicId,
      });
    }
  } catch (error) {
    await releaseClaim(db, userId, operationId);
    throw error;
  }

  if (callerCalls.length === pending.length) return { callIds, operationId };

  // Mixed batch: hand the park back to the runtime's completion barrier, which
  // resumes it once every tool of the batch has a result. If the other tools
  // already finished, the barrier passes now and this request runs the resume.
  await releaseClaim(db, userId, operationId);
  const resumed = await agentRuntimeService.tryResumeParentFromAsyncTool({
    parentOperationId: operationId,
  });
  return resumed ? { callIds, operationId } : { callIds, held: true, operationId };
};

/**
 * Narrow a resumed run's messages to the turn this response produced, in the
 * raw shape output items are built from. The resume reloads the conversation
 * from the database as display groups (`assistantGroup` with `children`), and
 * everything up to the answered calls was already returned by the response
 * that asked for them; returning those calls again would ask the caller to run
 * its tools a second time.
 */
const withResumedTurn = (state: AgentState, callIds: string[] = []): AgentState => {
  if (!state?.messages?.length) return state;

  const answered = new Set(callIds);
  const flat = state.messages.flatMap((message: any) =>
    message.role === 'assistantGroup'
      ? (message.children ?? []).map((child: any) => ({ ...child, role: 'assistant' }))
      : [message],
  );
  const callsOf = (message: any): { id?: string }[] => message.tool_calls ?? message.tools ?? [];
  const resumeIndex = flat.findLastIndex((message: any) =>
    callsOf(message).some((call) => !!call.id && answered.has(call.id)),
  );
  if (resumeIndex === -1) return state;

  const messages = flat.slice(resumeIndex + 1).map((message: any) =>
    message.tools
      ? {
          content: message.content,
          id: message.id,
          role: message.role,
          tool_calls: message.tools.map((tool: any) => ({
            function: { arguments: tool.arguments, name: `${tool.identifier}____${tool.apiName}` },
            id: tool.id,
            type: 'function',
          })),
        }
      : message,
  );
  return { ...state, messages };
};

/**
 * Run an operation to its next stop. A resumed park takes its first step as
 * the async-tool resume (refresh the tool results, re-enter the model); the
 * rest is the ordinary synchronous loop.
 */
export const executeResponseRun = async (
  agentRuntimeService: AgentRuntimeService,
  run: { callIds?: string[]; held?: boolean; operationId: string; resumed?: boolean },
): Promise<AgentState> => {
  if (!run.resumed) return agentRuntimeService.executeSync(run.operationId);

  const state = await agentRuntimeService.getCoordinator().loadAgentState(run.operationId);
  // Still parked on the batch's other tools: report the wait, without the calls
  // this request just answered.
  if (run.held && state) {
    const answered = new Set(run.callIds);
    return {
      ...state,
      messages: [],
      pendingToolsCalling: (state.pendingToolsCalling ?? []).filter(
        (tool: ChatToolPayload) => !answered.has(tool.id),
      ),
    };
  }

  const first = await agentRuntimeService.executeStep({
    operationId: run.operationId,
    resumeAsyncTool: true,
    stepIndex: state?.stepCount ?? 0,
  });
  // Stopped already (answered, or parked again): nothing is left to run, and
  // executeSync would hand back the saved state rather than this step's.
  const nextContext = first.stepResult?.nextContext;
  if (!nextContext || first.state?.status !== 'running')
    return withResumedTurn(first.state as AgentState, run.callIds);

  const final = await agentRuntimeService.executeSync(run.operationId, {
    initialContext: nextContext,
  });
  return withResumedTurn(final, run.callIds);
};

/**
 * The caller's function calls a run parked on, as output items it can answer.
 * A parked state is saved without its messages, so the calls cannot be read
 * back from them; without these items a non-streaming caller gets an
 * `incomplete` response with no `call_id` to send outputs for.
 */
export const pendingFunctionCallItems = (
  state: AgentState,
  output: OutputItem[],
  responseId: string,
): OutputItem[] => {
  const listed = new Set(output.map((item) => (item as { call_id?: string }).call_id));
  return ((state.pendingToolsCalling ?? []) as ChatToolPayload[])
    .filter((tool) => isCallerTool(tool) && !listed.has(tool.id))
    .map((tool, index) => ({
      arguments: tool.arguments || '{}',
      call_id: tool.id,
      id: `fc_${responseId}_pending_${index}`,
      name: tool.apiName,
      status: 'completed' as const,
      type: 'function_call' as const,
    }));
};

/**
 * Why the run stopped short of an answer, when it is parked on tools: the
 * caller's (`client_tool_execution`), or a batch that also waits on
 * server-side tools (`async_tool`). Such a response is `incomplete`, never
 * `completed`.
 */
export const parkedOnToolsReason = (state?: AgentState): string | undefined =>
  state?.status === 'waiting_for_async_tool'
    ? (state.interruption?.reason ?? 'client_tool_execution')
    : undefined;
