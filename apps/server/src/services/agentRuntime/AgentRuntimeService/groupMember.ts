import { type AgentState } from '@lobechat/agent-runtime';
import { getGroupMemberAnchorIndex, type GroupMemberAnchorMetadata } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import {
  extractTextFromMessage,
  findLastAssistantMessage,
  normalizeCompletionMessages,
} from '../CompletionLifecycle';
import {
  type AgentExecutionResult,
  type GroupActionMemberBridgeParams,
  type GroupMemberTimeoutParams,
} from '../types';
import type { AgentRuntimeServiceContext } from './types';
import { formatErrorForMetadata, formatSubAgentErrorReason } from './utils';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type GroupMemberDeps = Pick<
  AgentRuntimeServiceContext,
  | 'agentOperationModel'
  | 'baseURL'
  | 'completeGroupActionMember'
  | 'completeGroupMemberBarrier'
  | 'controlCompletedToolResult'
  | 'coordinator'
  | 'countFulfilledMemberAnchors'
  | 'interruptOperation'
  | 'maybeScheduleAsyncToolVerify'
  | 'messageModel'
  | 'queryMessagesFromDB'
  | 'queueService'
  | 'resolveLastAssistantContentFromThread'
  | 'resolveLastAssistantMessageFromDB'
  | 'serverDB'
  | 'tryResumeParentFromAsyncTool'
>;

/**
 * The completion bridge of a group member run: from its runtime snapshot
 * while it lives, else from the durable copy recorded on the operation row
 * at start. Undefined for any run that is not a group member.
 */
export async function loadGroupMemberBridge(
  deps: GroupMemberDeps,
  operationId: string,
): Promise<
  | {
      agentId: string;
      bridge: Omit<GroupActionMemberBridgeParams, 'operationId' | 'reason'>;
      groupId?: string;
      threadId?: string;
      topicId?: string;
    }
  | undefined
> {
  const state = await deps.coordinator.loadAgentState(operationId);
  if (state) {
    const origin = state.origin;
    const bridge = state.host?.hooks?.find((hook) => hook.id === 'group-member-bridge')?.webhook
      ?.body as Omit<GroupActionMemberBridgeParams, 'operationId' | 'reason'> | undefined;
    if (origin?.lineage?.orchestrationRole !== 'member' || !origin.agentId || !bridge) {
      return undefined;
    }
    return {
      agentId: origin.agentId,
      bridge,
      groupId: origin.groupId ?? undefined,
      threadId: origin.threadId ?? undefined,
      topicId: origin.topicId ?? undefined,
    };
  }

  const row = await deps.agentOperationModel.findById(operationId);
  const bridge = (row?.metadata as Record<string, unknown> | null | undefined)
    ?.groupMemberBridge as
    Omit<GroupActionMemberBridgeParams, 'operationId' | 'reason'> | undefined;
  if (!row?.agentId || !bridge) return undefined;
  return {
    agentId: row.agentId,
    bridge,
    groupId: row.chatGroupId ?? undefined,
    threadId: row.threadId ?? undefined,
    topicId: row.topicId ?? undefined,
  };
}

/** One member anchor under a multi-member group-management tool call. */
interface GroupMemberAnchorResult {
  agentId?: string;
  content: string;
  index?: number;
  status?: string;
}

/**
 * Read the member anchors under a group-management tool call — child
 * `role: 'tool'` messages, one per member, holding that member's result.
 */
async function loadGroupMemberAnchors(
  deps: GroupMemberDeps,
  groupToolMessageId: string,
): Promise<GroupMemberAnchorResult[]> {
  const children = await deps.serverDB.query.messages.findMany({
    where: (m, { and, eq }) => and(eq(m.parentId, groupToolMessageId), eq(m.role, 'tool')),
  });
  return pMap(
    children,
    async (child) => {
      const plugin = await deps.serverDB.query.messagePlugins.findFirst({
        where: (mp, { eq }) => eq(mp.id, child.id),
      });
      const metadata = child.metadata as { groupMemberAnchor?: GroupMemberAnchorMetadata } | null;
      return {
        agentId: metadata?.groupMemberAnchor?.agentId,
        content: child.content ?? '',
        index: getGroupMemberAnchorIndex(
          { metadata, role: 'tool', tool_call_id: plugin?.toolCallId },
          'tool',
        ),
        status: (plugin?.state as { status?: string } | null | undefined)?.status,
      };
    },
    { concurrency: 5 },
  );
}

/**
 * Count fulfilled member anchors under a group-management tool call — child
 * `role: 'tool'` messages whose content is non-empty or whose pluginState is
 * terminal. The K=N member barrier for broadcast / executeAgentTasks: the
 * group tool message is only backfilled (satisfying the parked op's
 * single-tool barrier) once this reaches the expected member count.
 */
export async function countFulfilledMemberAnchors(
  deps: GroupMemberDeps,
  groupToolMessageId: string,
): Promise<number> {
  const anchors = await loadGroupMemberAnchors(deps, groupToolMessageId);
  return anchors.filter(
    (anchor) =>
      anchor.content.length > 0 || anchor.status === 'completed' || anchor.status === 'error',
  ).length;
}

/**
 * The group tool result the supervisor reads once every member is done. The
 * member anchors are hidden from the conversation the supervisor is resumed
 * with, and a broadcast's in-bubble council never reaches the model either, so
 * this content is the only place the supervisor can read what each member
 * produced. A bare completion count left it to invent the members' work.
 */
export async function buildGroupMemberResultsContent(
  deps: GroupMemberDeps,
  groupToolMessageId: string,
  expectedMembers: number,
): Promise<string> {
  const anchors = await loadGroupMemberAnchors(deps, groupToolMessageId);
  anchors.sort(
    (a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER),
  );
  const failedCount = anchors.filter((anchor) => anchor.status === 'error').length;
  const summary =
    failedCount === 0
      ? `All ${expectedMembers} agent members completed.`
      : `${expectedMembers - failedCount} of ${expectedMembers} agent members completed; ${failedCount} did not.`;
  const results = anchors.map((anchor) => {
    const attributes = [
      anchor.index !== undefined && `index="${anchor.index + 1}"`,
      anchor.agentId && `agentId="${anchor.agentId}"`,
      `status="${anchor.status === 'error' ? 'error' : 'completed'}"`,
    ]
      .filter(Boolean)
      .join(' ');
    // A member can quote markup back (e.g. from a fetched page); keep it from
    // closing its block early and posing as another member's result.
    const body = anchor.content.trim().replaceAll('</member_result', '<\\/member_result');
    return `<member_result ${attributes}>\n${body || '(no textual answer)'}\n</member_result>`;
  });
  return [`${summary} Each member's result follows.`, ...results].join('\n\n');
}

/**
 * The final reply an in-group broadcast member wrote into the shared group
 * conversation: the last assistant text in the subtree under the member run's
 * own assistant row, authored by that member. The whole group conversation is
 * shared, so the latest assistant overall may belong to a sibling member or to
 * the supervisor's next turn.
 */
export async function resolveInGroupMemberReply(
  deps: GroupMemberDeps,
  state: AgentState,
): Promise<string | undefined> {
  const rootId = state.origin?.assistantMessageId;
  const memberAgentId = state.origin?.agentId;
  if (!rootId || !memberAgentId) return undefined;

  const messages = await deps.queryMessagesFromDB(state);
  const childrenByParent = new Map<string, typeof messages>();
  for (const message of messages) {
    if (!message.parentId || message.agentId !== memberAgentId) continue;
    const siblings = childrenByParent.get(message.parentId) ?? [];
    siblings.push(message);
    childrenByParent.set(message.parentId, siblings);
  }

  const root = messages.find((message) => message.id === rootId);
  if (!root) return undefined;
  const subtree = [root];
  for (let i = 0; i < subtree.length; i += 1) {
    subtree.push(...(childrenByParent.get(subtree[i].id) ?? []));
  }

  const replies = subtree
    .filter((message) => message.role === 'assistant')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (let i = replies.length - 1; i >= 0; i -= 1) {
    const text = extractTextFromMessage(replies[i]);
    if (text) return text;
  }
  return undefined;
}

/**
 * Completion bridge for the group orchestration "call agent member" path
 * (`lobe-group-management`: speak / broadcast / delegate / executeAgentTask(s)).
 * Mirrors {@link completeSubAgentBridge} but enforces a K=N member barrier:
 *
 *   1. Backfill this member's anchor tool message (single in_group speak → a
 *      short receipt, since the reply is part of the supervisor's context;
 *      broadcast member → its reply, which only renders as an in-bubble
 *      council the model never reads; isolated → the member's final answer
 *      from its hidden thread).
 *   2. Multi-member actions: hold until every member anchor is fulfilled, then
 *      backfill the supervisor's group tool message with every member's result
 *      so the parked op's single-tool barrier passes. Single-member actions
 *      collapse the anchor onto the group tool call, so step 1 already
 *      satisfies the barrier.
 *   3. Barrier-check + CAS resume/finish the parked supervisor via
 *      `tryResumeParentFromAsyncTool` (finish disposition read from the group
 *      tool message's pluginState).
 *
 * THROWS on infra failure of any backfill so the queue-mode callback returns
 * non-2xx and QStash redelivers — backfills are idempotent and the resume is
 * CAS-guarded, so redelivery is safe.
 */
export async function completeGroupActionMember(
  deps: GroupMemberDeps,
  params: GroupActionMemberBridgeParams,
): Promise<boolean> {
  const {
    anchorMessageId,
    expectedMembers,
    groupToolMessageId,
    mode,
    operationId,
    parentOperationId,
    reason,
    threadId,
  } = params;
  const failed = reason === 'error' || reason === 'interrupted' || reason === 'timeout';

  // Members answer to the supervisor's approval mode, so a member can park on
  // a tool that needs the user's approval. That segment fires `onComplete`
  // (so the approval surfaces), but the member has not answered yet: leave its
  // anchor pending and the supervisor parked. The approval continuation
  // inherits this bridge hook and reports the member's real outcome.
  if (reason === 'waiting_for_human') {
    log(
      '[%s] group-member bridge: member parked for human approval, holding parent %s',
      operationId,
      parentOperationId,
    );
    return false;
  }

  const finalState =
    params.finalState ?? (await deps.coordinator.loadAgentState(operationId)) ?? undefined;

  log(
    '[%s] group-member bridge → parent %s (mode: %s, reason: %s, %d members)',
    operationId,
    parentOperationId,
    mode,
    reason,
    expectedMembers,
  );

  // 1. Backfill this member's anchor.
  // The member's textual answer is only read in delegate mode below; a state
  // loaded via the fallback above arrives without `messages` (dropped from
  // the persisted Redis blob — see AgentStateManager.serializeStateForPersist),
  // so resolve the original final leaf from the DB when we actually need it.
  // Keeping the original row preserves the exact content/metadata pairing
  // that conversation-flow display grouping intentionally aggregates.
  let lastAssistant: unknown;
  if (!failed && mode !== 'in_group' && finalState && !Array.isArray(finalState.messages)) {
    try {
      lastAssistant = await deps.resolveLastAssistantMessageFromDB(finalState);
    } catch (error) {
      console.error(
        '[%s] group-member bridge: failed to resolve final assistant from DB: %O',
        operationId,
        error,
      );
    }
  }
  const messages = Array.isArray(finalState?.messages) ? finalState.messages : [];
  lastAssistant ??= findLastAssistantMessage(normalizeCompletionMessages(messages));
  let lastAssistantContent = extractTextFromMessage(lastAssistant);

  // Gated on `!finalState`, not merely an empty `lastAssistantContent` —
  // see the identical guard (and its full rationale) in
  // `completeSubAgentBridge`. A real final state whose last turn is
  // legitimately textless must keep the stub below, not risk surfacing a
  // stale earlier reply from the thread's own history. `!finalState` is
  // exactly the heterogeneous-isolated-member case this fallback exists
  // for: it never populates `finalState` at all.
  if (!failed && mode !== 'in_group' && !finalState && threadId) {
    try {
      lastAssistantContent = await deps.resolveLastAssistantContentFromThread(threadId);
    } catch (error) {
      console.error(
        '[%s] group-member bridge: failed to resolve content from thread %s: %O',
        operationId,
        threadId,
        error,
      );
    }
  }
  // A broadcast member's reply renders inside the supervisor's council bubble,
  // which the context engine drops, so carry it on the anchor for the group
  // tool result. A single speak's reply is an ordinary message the supervisor
  // already reads, so its receipt stays short.
  const isCouncilMember = mode === 'in_group' && anchorMessageId !== groupToolMessageId;
  let councilReply: string | undefined;
  if (!failed && isCouncilMember && finalState) {
    try {
      councilReply = await resolveInGroupMemberReply(deps, finalState);
    } catch (error) {
      console.error(
        '[%s] group-member bridge: failed to resolve in-group reply from DB: %O',
        operationId,
        error,
      );
    }
    // The receipt below gives the supervisor nothing to read, so leave a trace.
    if (!councilReply)
      console.warn(
        '[%s] group-member bridge: no in-group reply under %s, writing a receipt',
        operationId,
        finalState.origin?.assistantMessageId,
      );
  }
  const agentLabel = (finalState?.origin?.agentId as string | undefined) ?? 'member';
  const memberErrorReason = failed ? formatSubAgentErrorReason(finalState?.error) : undefined;
  const anchorContent = failed
    ? memberErrorReason
      ? `Agent member did not complete (${reason}): ${memberErrorReason}`
      : `Agent member did not complete (${reason}).`
    : mode === 'in_group'
      ? councilReply || `Agent ${agentLabel} responded in the group.`
      : lastAssistantContent || 'Agent member completed without a textual answer.';

  const { result: completed, blocked } = await deps.controlCompletedToolResult({
    preserveUsage: true,
    contextToolMessageId: groupToolMessageId,
    operationId: parentOperationId,
    toolMessageId: anchorMessageId,
    result: {
      content: anchorContent,
      success: !failed,
      error: failed ? formatErrorForMetadata(finalState?.error) : undefined,
      state: {
        model: finalState?.modelRuntimeConfig?.model,
        status: failed ? 'error' : 'completed',
        threadId,
        // The child's spend rides on this anchor row so the parent's usage tray can
        // account for it. The tray sums per-MESSAGE usage, and the child's own
        // assistant messages live in an isolation thread the parent never loads —
        // this row is the only place the child's cost surfaces in the parent's own
        // message list.
        totalCost: finalState?.cost?.total,
        totalInputTokens: finalState?.usage?.llm?.tokens?.input,
        totalOutputTokens: finalState?.usage?.llm?.tokens?.output,
        totalToolCalls: finalState?.usage?.tools?.totalCalls,
        totalTokens: finalState?.usage?.llm?.tokens?.total,
      },
    },
  });
  const anchorBackfill = await deps.messageModel.updateToolMessage(anchorMessageId, {
    content: completed.content,
    pluginError: completed.error ?? null,
    pluginState: completed.state,
    onlyIfEmpty: true,
    ...(blocked && { replacePluginState: true }),
  });
  if (!anchorBackfill.success) {
    throw new Error(
      `Group-member bridge: failed to backfill anchor ${anchorMessageId} for parent ${parentOperationId}`,
    );
  }

  return deps.completeGroupMemberBarrier({
    anchorMessageId,
    expectedMembers,
    groupToolMessageId,
    parentOperationId,
  });
}

/** Shared by a child's completion and a member that failed before an operation existed. */
export async function completeGroupMemberBarrier(
  deps: GroupMemberDeps,
  {
    anchorMessageId,
    expectedMembers,
    groupToolMessageId,
    parentOperationId,
  }: Pick<
    GroupActionMemberBridgeParams,
    'anchorMessageId' | 'expectedMembers' | 'groupToolMessageId' | 'parentOperationId'
  >,
): Promise<boolean> {
  // 2. K=N member barrier (multi-member actions only — single-member actions
  //    use the group tool call itself as the anchor, already backfilled above).
  if (expectedMembers > 1 && anchorMessageId !== groupToolMessageId) {
    const fulfilled = await deps.countFulfilledMemberAnchors(groupToolMessageId);
    if (fulfilled < expectedMembers) {
      log(
        '[%s] group-member barrier %d/%d, holding parent %s',
        parentOperationId,
        fulfilled,
        expectedMembers,
        parentOperationId,
      );
      const parentState = await deps.coordinator.loadAgentState(parentOperationId);
      if (parentState) {
        await deps.maybeScheduleAsyncToolVerify(parentOperationId, parentState, {
          scheduleVerifyOnHold: true,
        });
      }
      return false;
    }

    // All members done — backfill the group tool call so the parked op's
    // single-tool barrier ([groupTool]) passes. Idempotent across racing
    // last-committers; the resume/finish CAS guarantees one transition.
    const content = await buildGroupMemberResultsContent(deps, groupToolMessageId, expectedMembers);
    const { result: groupResult, blocked: groupBlocked } = await deps.controlCompletedToolResult({
      operationId: parentOperationId,
      toolMessageId: groupToolMessageId,
      result: {
        content,
        state: { expectedMembers, status: 'completed' },
        success: true,
      },
    });
    const groupBackfill = await deps.messageModel.updateToolMessage(groupToolMessageId, {
      content: groupResult.content,
      pluginError: groupResult.error ?? null,
      pluginState: groupResult.state,
      onlyIfEmpty: true,
      ...(groupBlocked && {
        replacePluginState: true,
      }),
    });
    if (!groupBackfill.success) {
      throw new Error(
        `Group-member bridge: failed to backfill group tool ${groupToolMessageId} for parent ${parentOperationId}`,
      );
    }
  }

  // 3. Barrier + CAS + resume/finish the parked supervisor op.
  return deps.tryResumeParentFromAsyncTool({ parentOperationId }, { scheduleVerifyOnHold: true });
}

/**
 * Schedule the group-member timeout watchdog. Fired `delayMs` after the member
 * op is forked; if the member hasn't finished by then, the watchdog interrupts
 * it and bridges a `timeout` completion so the parked supervisor doesn't wait
 * forever. No-op when the queue is disabled or the timeout is non-positive.
 */
export async function scheduleGroupMemberTimeout(
  deps: GroupMemberDeps,
  params: GroupMemberTimeoutParams,
  delayMs: number,
): Promise<void> {
  if (!deps.queueService || !(delayMs > 0)) return;
  try {
    await deps.queueService.scheduleMessage({
      context: undefined,
      delay: delayMs,
      endpoint: `${deps.baseURL}/run`,
      // Keyed on the member op so the /run worker can resolve userId from its
      // metadata, same trust chain as every other scheduled step.
      operationId: params.memberOperationId,
      payload: { groupMemberTimeout: params },
      priority: 'normal',
      stepIndex: 0,
    });
    log(
      '[%s] scheduled group-member timeout in %dms (parent %s)',
      params.memberOperationId,
      delayMs,
      params.parentOperationId,
    );
  } catch (error) {
    log(
      '[%s] failed to schedule group-member timeout (non-fatal): %O',
      params.memberOperationId,
      error,
    );
  }
}

/**
 * Enforce a group member's timeout. No-op if the member already reached a
 * terminal state (its own completion bridge handles that). Otherwise interrupt
 * the member and bridge a `timeout` completion — backfilling its anchor and
 * resuming/finishing the parked supervisor via the K=N barrier. The member's
 * own interrupt bridge may also fire; both are idempotent (anchor rewrite +
 * CAS-guarded resume).
 */
export async function handleGroupMemberTimeout(
  deps: GroupMemberDeps,
  params: GroupMemberTimeoutParams,
): Promise<AgentExecutionResult> {
  const state = await deps.coordinator.loadAgentState(params.memberOperationId);
  const status = state?.status as string | undefined;
  if (!state || status === 'done' || status === 'error' || status === 'interrupted') {
    log(
      '[%s] group-member timeout: member already terminal (%s), no-op',
      params.memberOperationId,
      status,
    );
    return { nextStepScheduled: false, state: {}, success: true };
  }

  log(
    '[%s] group-member timeout fired, interrupting + bridging timeout to parent %s',
    params.memberOperationId,
    params.parentOperationId,
  );
  await deps.interruptOperation(params.memberOperationId);

  const resumed = await deps.completeGroupActionMember({
    anchorMessageId: params.anchorMessageId,
    expectedMembers: params.expectedMembers,
    finalState: state,
    groupToolMessageId: params.groupToolMessageId,
    mode: params.mode,
    onComplete: params.onComplete,
    operationId: params.memberOperationId,
    parentOperationId: params.parentOperationId,
    reason: 'timeout',
  });

  return { nextStepScheduled: resumed, state: {}, success: true };
}
