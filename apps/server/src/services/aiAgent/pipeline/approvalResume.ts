import type { AgentRuntimeContext } from '@lobechat/agent-runtime';
import type { ExecAgentResult, MessagePluginItem } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { matchesAgentInterventionContinuationProvenance } from '@/business/server/agent-run/agentInterventionIdentity';
import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { HumanApprovalResolution, MessageModel } from '@/database/models/message';
import { HumanApprovalAlreadyResolvedError } from '@/database/models/message';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';

import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

/**
 * Mutable rollback guard owned by `execAgentWithApprovalRollback`. The claim
 * stage fills `rollbackSnapshot` when it flips pending rows; the continuation
 * stages set the `continuation*` flags to disarm the rollback once the
 * decision has a durable owner.
 */
export interface ApprovalClaimState {
  continuationPrepared: boolean;
  continuationStarted: boolean;
  rollbackSnapshot: HumanApprovalResolution[];
}

export interface ClaimApprovalResumeInput {
  appContext?: InternalExecAgentParams['appContext'];
  approvalClaim: ApprovalClaimState;
  /** Single + batch approval forms normalized into one list by the caller. */
  approvalDecisions: NonNullable<InternalExecAgentParams['resumeApprovals']>;
  parentMessageId?: string;
  providedApprovalResolutionRequestId?: string;
  providedApprovalSourceOperationId?: string;
  /** Raw batch wire form — gates the batch-only spine anchor. */
  resumeApprovals?: InternalExecAgentParams['resumeApprovals'];
  resumeParentMessage: Awaited<ReturnType<MessageModel['findById']>>;
  resumeToolResult?: InternalExecAgentParams['resumeToolResult'];
}

export interface ClaimedApprovalResume {
  /** Assistant that emitted this batch — the pending tool rows' shared parent. */
  approvalOwnerAssistantId?: string;
  approvalResolutionRequestId?: string;
  approvalSourceOperationId?: string;
  approvalSourceToolMessageIds: string[];
  /**
   * Approved decisions paired with their plugin row, in the order the caller
   * listed them. Drives the batch resume context at 16b; the tool message id
   * doubles as the row `call_tools_batch` fills in place.
   */
  approvedToolEntries: { createdAt: Date; plugin: MessagePluginItem; toolMessageId: string }[];
  /**
   * Spine anchor for a batch approval: the ASSISTANT that emitted the batch —
   * i.e. the previous LLM call. A step is one LLM call, and tool rows are
   * inline data of the call that produced them, never spine nodes. So the
   * continuation assistant chains directly onto that assistant
   * (`user → asst → asst …`, tools hanging off their caller) rather than onto
   * one of the batch's tool rows, which would make the spine depend on which
   * tool row you happened to pick and on the order they were written in.
   */
  batchApprovalAnchorId?: string;
  /** Plugin row of the op-level anchor message (single-decision 16b context). */
  resumeApprovalPlugin?: MessagePluginItem;
}

/**
 * Stages 2.6 + 2.7 of {@link AiAgentService.execAgent}.
 *
 * 2.6 Human-approval resume: write the user's decision to the target tool
 * message in the DB so the history fetched later (step 11) + the runtime
 * state both reflect the decision before the first step runs. Validates
 * the parent is actually a pending tool message tied to the tool call we
 * were asked about — guards against stale / double-clicks.
 *
 * 2.7 Human-answer resume: a `humanIntervention: 'always'` tool (e.g.
 * lobe-agent `askUserQuestion`) paused this run. Write the human-provided
 * answer as the target tool message's result and mark the intervention
 * approved. Unlike `resumeApproval` (`approved`), the run resumes from
 * `phase: 'tool_result'` (see 16c) rather than re-executing the tool — the
 * answer IS the result. `resumeApproval` and `resumeToolResult` are mutually
 * exclusive (validated by the caller).
 *
 * Note: `messages` and `message_plugins` live in separate tables. The
 * `messageModel.findById` query returns the `messages` row only — the
 * tool_call_id / apiName / identifier / arguments / type fields live on
 * the plugin row and must be fetched separately.
 */
export const claimApprovalResume = async (
  deps: { messageModel: MessageModel },
  input: ClaimApprovalResumeInput,
): Promise<ClaimedApprovalResume> => {
  const {
    appContext,
    approvalClaim,
    approvalDecisions,
    parentMessageId,
    providedApprovalResolutionRequestId,
    providedApprovalSourceOperationId,
    resumeApprovals,
    resumeParentMessage,
    resumeToolResult,
  } = input;

  let resumeApprovalPlugin: MessagePluginItem | undefined;
  const approvedToolEntries: {
    createdAt: Date;
    plugin: MessagePluginItem;
    toolMessageId: string;
  }[] = [];
  let approvalOwnerAssistantId: string | undefined;
  let approvalResolutionRequestId: string | undefined;
  let approvalSourceOperationId: string | undefined;
  let approvalSourceToolMessageIds: string[] = [];

  // Load and validate EVERY decision before applying any of them. The apply
  // step writes per entry, so validating inline would leave a rejected batch
  // half-persisted — some tools already marked approved with no run to
  // execute them.
  const validatedDecisions: {
    alreadyClaimed: boolean;
    entry: (typeof approvalDecisions)[number];
    plugin: MessagePluginItem;
    targetMessage: NonNullable<typeof resumeParentMessage>;
  }[] = [];

  for (const decisionEntry of approvalDecisions) {
    // The single-decision form validated `parentMessageId` (the op-level
    // resume anchor) as the target tool message. In the batch form each
    // decision names its own tool message, so load and validate per entry —
    // the op-level anchor is only one of them.
    const targetMessage =
      decisionEntry.parentMessageId === parentMessageId
        ? resumeParentMessage
        : await deps.messageModel.findById(decisionEntry.parentMessageId);

    if (!targetMessage) {
      throw new Error(`resumeApproval: tool message not found: ${decisionEntry.parentMessageId}`);
    }
    if (targetMessage.role !== 'tool') {
      throw new Error(
        `resumeApproval.parentMessageId must point at a role='tool' message, got role='${targetMessage.role}'`,
      );
    }
    if (targetMessage.topicId !== appContext?.topicId) {
      throw new Error('appContext.topicId does not match approval target message');
    }

    const plugin = await deps.messageModel.findMessagePlugin(decisionEntry.parentMessageId);
    if (!plugin) {
      throw new Error(
        `resumeApproval: no plugin row for tool message ${decisionEntry.parentMessageId}`,
      );
    }
    if (plugin.toolCallId && plugin.toolCallId !== decisionEntry.toolCallId) {
      throw new Error(
        `resumeApproval.toolCallId mismatch for message ${decisionEntry.parentMessageId}: ` +
          `stored=${plugin.toolCallId}, requested=${decisionEntry.toolCallId}`,
      );
    }
    const expectedStatus = decisionEntry.decision === 'approved' ? 'approved' : 'rejected';
    const alreadyClaimed =
      plugin.intervention?.status === expectedStatus &&
      Boolean(providedApprovalResolutionRequestId) &&
      plugin.intervention.resolutionRequestId === providedApprovalResolutionRequestId;
    if (plugin.intervention?.status !== 'pending' && !alreadyClaimed) {
      throw new HumanApprovalAlreadyResolvedError(decisionEntry.parentMessageId);
    }

    validatedDecisions.push({ alreadyClaimed, entry: decisionEntry, plugin, targetMessage });
  }

  // A batch resume executes every approved tool as ONE `call_tools_batch`
  // under ONE assistant anchor and continues the LLM once. That is only
  // meaningful when the calls actually came from the same assistant turn.
  // The client scopes its selection, but a stale or hand-built request could
  // mix an abandoned approval from an earlier turn into this one — which
  // would run an unrelated tool and fold its result into a turn it does not
  // belong to. Reject rather than silently anchoring on whichever entry came
  // first.
  const approvalOwnerIds = new Set(
    validatedDecisions.map(({ targetMessage }) => targetMessage.parentId ?? '(none)'),
  );
  if (approvalOwnerIds.size > 1) {
    throw new Error(
      `resumeApprovals must resolve one assistant turn, got ${approvalOwnerIds.size} owners: ` +
        [...approvalOwnerIds].join(', '),
    );
  }

  if (validatedDecisions.length > 0) {
    const sourceOperationIds = new Set(
      validatedDecisions
        .map(({ plugin }) => plugin.intervention?.operationId)
        .filter((id): id is string => typeof id === 'string' && !!id),
    );
    if (
      sourceOperationIds.size > 1 ||
      (providedApprovalSourceOperationId &&
        (sourceOperationIds.size !== 1 ||
          !sourceOperationIds.has(providedApprovalSourceOperationId)))
    ) {
      throw new Error('Approval targets do not match the authoritative parked operation');
    }
    approvalSourceOperationId = providedApprovalSourceOperationId ?? [...sourceOperationIds][0];
    approvalSourceToolMessageIds = validatedDecisions.map(({ entry }) => entry.parentMessageId);
    approvalResolutionRequestId = providedApprovalResolutionRequestId ?? `legacy_${nanoid()}`;
    const unclaimedDecisions = validatedDecisions.filter(({ alreadyClaimed }) => !alreadyClaimed);
    const approvalRollbackSnapshot = unclaimedDecisions.map(({ plugin, targetMessage }) => ({
      claimedResolutionRequestId: approvalResolutionRequestId,
      ...(typeof targetMessage.content === 'string' ? { content: targetMessage.content } : {}),
      id: targetMessage.id,
      intervention: (plugin.intervention ?? { status: 'pending' }) as Record<string, unknown>,
      pluginState: (plugin.state ?? null) as Record<string, unknown> | null,
      replacePluginState: true,
    }));

    // Shared exactly-once boundary for Web, Mobile, Stop, and signed system
    // actions. All rows are locked and checked before the first write.
    if (unclaimedDecisions.length > 0) {
      const claimState = await deps.messageModel.resolveHumanApproval(
        unclaimedDecisions.map(({ entry }) => {
          if (entry.decision === 'approved') {
            return {
              id: entry.parentMessageId,
              intervention: {
                resolutionRequestId: approvalResolutionRequestId,
                status: 'approved',
              },
            };
          }
          return {
            content: entry.rejectionReason
              ? `User reject this tool calling with reason: ${entry.rejectionReason}`
              : 'User reject this tool calling without reason',
            id: entry.parentMessageId,
            intervention: {
              rejectedReason: entry.rejectionReason,
              resolutionRequestId: approvalResolutionRequestId,
              status: 'rejected',
            },
          };
        }),
      );
      if (claimState === 'applied') {
        approvalClaim.rollbackSnapshot = approvalRollbackSnapshot;
      }
    }
    if (providedApprovalResolutionRequestId) {
      // A generic durable claim is recovered by this same request id. Never
      // locally reopen its source rows: a concurrent reentrant same-id call
      // may already have created the deterministic assistant/op/state.
      approvalClaim.continuationPrepared = true;
    }
  }

  for (const { entry: decisionEntry, plugin, targetMessage } of validatedDecisions) {
    const { decision } = decisionEntry;
    if (decision === 'approved') {
      approvedToolEntries.push({
        createdAt: targetMessage.createdAt,
        plugin,
        toolMessageId: decisionEntry.parentMessageId,
      });
      approvalOwnerAssistantId ??= targetMessage.parentId ?? undefined;
    }

    // Kept for the single-decision resume context at 16b, which reads the
    // plugin of the op-level anchor message.
    if (decisionEntry.parentMessageId === parentMessageId) resumeApprovalPlugin = plugin;

    log(
      'execAgent: resumeApproval decision=%s applied to tool message %s (toolCallId=%s)',
      decision,
      decisionEntry.parentMessageId,
      decisionEntry.toolCallId,
    );
  }

  // The approval pause creates one row per pending tool sequentially, in the
  // order the model emitted the calls — so row creation order IS declaration
  // order, and sorting by it makes the resume independent of how the client
  // happened to order its request array.
  approvedToolEntries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const batchApprovalAnchorId = resumeApprovals?.length ? approvalOwnerAssistantId : undefined;

  // 2.7. Human-answer resume — see the function doc above.
  if (resumeToolResult) {
    if (!resumeParentMessage) {
      throw new Error('resumeToolResult requires parentMessageId to point at a tool message');
    }
    if (resumeParentMessage.role !== 'tool') {
      throw new Error(
        `resumeToolResult.parentMessageId must point at a role='tool' message, got role='${resumeParentMessage.role}'`,
      );
    }

    const resumeToolResultPlugin = await deps.messageModel.findMessagePlugin(
      resumeToolResult.parentMessageId,
    );
    if (!resumeToolResultPlugin) {
      throw new Error(
        `resumeToolResult: no plugin row for tool message ${resumeToolResult.parentMessageId}`,
      );
    }
    if (
      resumeToolResultPlugin.toolCallId &&
      resumeToolResultPlugin.toolCallId !== resumeToolResult.toolCallId
    ) {
      throw new Error(
        `resumeToolResult.toolCallId mismatch for message ${resumeToolResult.parentMessageId}: ` +
          `stored=${resumeToolResultPlugin.toolCallId}, requested=${resumeToolResult.toolCallId}`,
      );
    }
    const skipped = resumeToolResult.outcome === 'skipped';
    const expectedToolResultStatus = skipped ? 'rejected' : 'approved';
    const alreadyClaimed =
      resumeToolResultPlugin.intervention?.status === expectedToolResultStatus &&
      Boolean(providedApprovalResolutionRequestId) &&
      resumeToolResultPlugin.intervention.resolutionRequestId ===
        providedApprovalResolutionRequestId &&
      (!skipped || resumeToolResultPlugin.intervention.skipped === true);
    if (resumeToolResultPlugin.intervention?.status !== 'pending' && !alreadyClaimed) {
      throw new HumanApprovalAlreadyResolvedError(resumeToolResult.parentMessageId);
    }
    const toolResultSourceOperationId = resumeToolResultPlugin.intervention?.operationId;
    if (
      providedApprovalSourceOperationId &&
      toolResultSourceOperationId !== providedApprovalSourceOperationId
    ) {
      throw new Error('Approval target does not match the authoritative parked operation');
    }
    approvalSourceOperationId =
      providedApprovalSourceOperationId ?? toolResultSourceOperationId ?? undefined;
    approvalSourceToolMessageIds = [resumeToolResult.parentMessageId];

    approvalResolutionRequestId = providedApprovalResolutionRequestId ?? `legacy_${nanoid()}`;
    const approvalRollbackSnapshot = alreadyClaimed
      ? []
      : [
          {
            claimedResolutionRequestId: approvalResolutionRequestId,
            ...(typeof resumeParentMessage.content === 'string'
              ? { content: resumeParentMessage.content }
              : {}),
            id: resumeToolResult.parentMessageId,
            intervention: (resumeToolResultPlugin.intervention ?? {
              status: 'pending',
            }) as Record<string, unknown>,
            pluginState: (resumeToolResultPlugin.state ?? null) as Record<string, unknown> | null,
            replacePluginState: true,
          },
        ];
    if (!alreadyClaimed) {
      const claimState = await deps.messageModel.resolveHumanApproval([
        {
          content: resumeToolResult.content,
          id: resumeToolResult.parentMessageId,
          intervention: skipped
            ? {
                rejectedReason: resumeToolResult.rejectionReason,
                resolutionRequestId: approvalResolutionRequestId,
                skipped: true,
                status: 'rejected',
              }
            : { resolutionRequestId: approvalResolutionRequestId, status: 'approved' },
          pluginState: resumeToolResult.pluginState,
        },
      ]);
      if (claimState === 'applied') {
        approvalClaim.rollbackSnapshot = approvalRollbackSnapshot;
      }
    }
    if (providedApprovalResolutionRequestId) {
      approvalClaim.continuationPrepared = true;
    }

    log(
      'execAgent: resumeToolResult applied to tool message %s (toolCallId=%s)',
      resumeToolResult.parentMessageId,
      resumeToolResult.toolCallId,
    );
  }

  return {
    approvalOwnerAssistantId,
    approvalResolutionRequestId,
    approvalSourceOperationId,
    approvalSourceToolMessageIds,
    approvedToolEntries,
    batchApprovalAnchorId,
    resumeApprovalPlugin,
  };
};

export interface ReuseInterventionContinuationDeps {
  agentOperationModel: AgentOperationModel;
  agentRuntimeService: AgentRuntimeService;
  messageModel: MessageModel;
  userId: string;
  withholdGatewayToken: boolean;
  workspaceId?: string;
}

export interface ReuseInterventionContinuationInput {
  approvalClaim: ApprovalClaimState;
  approvalSourceOperationId?: string;
  approvalSourceToolMessageIds: string[];
  continuationAssistantId?: string;
  continuationOperationId?: string;
  parentMessageId?: string;
  providedApprovalResolutionRequestId?: string;
  resolvedAgentId: string;
  topicId?: string | null;
}

/**
 * Deterministic-continuation reuse probe for a generic (v2) approval claim.
 *
 * This check runs *inside* the topic-start reservation. Two same-request
 * callers may both probe before the first claim is visible, but only the
 * winner reaches createOperation; the follower observes and reuses its
 * deterministic state here instead of overwriting it. Idle state is
 * explicitly requeued from its saved initialContext; operation+step locks
 * de-duplicate concurrent queue delivery.
 *
 * Returns the terminal {@link ExecAgentResult} when the continuation already
 * exists and was requeued, or `undefined` to continue the normal path.
 */
export const tryReuseInterventionContinuation = async (
  deps: ReuseInterventionContinuationDeps,
  input: ReuseInterventionContinuationInput,
): Promise<ExecAgentResult | undefined> => {
  const {
    approvalClaim,
    approvalSourceOperationId,
    approvalSourceToolMessageIds,
    continuationAssistantId,
    continuationOperationId,
    parentMessageId,
    providedApprovalResolutionRequestId,
    resolvedAgentId,
    topicId,
  } = input;

  if (
    !continuationOperationId ||
    !continuationAssistantId ||
    !providedApprovalResolutionRequestId ||
    !approvalSourceOperationId ||
    !topicId
  ) {
    return undefined;
  }

  const existingState =
    await deps.agentRuntimeService.loadInterventionContinuationState(continuationOperationId);
  const preparation = existingState?.metadata?.agentInterventionPreparation as
    { resolutionRequestId?: unknown; state?: unknown } | undefined;
  if (
    !existingState ||
    preparation?.state !== 'ready' ||
    preparation.resolutionRequestId !== providedApprovalResolutionRequestId
  ) {
    return undefined;
  }

  const existingOperation = await deps.agentOperationModel.findById(continuationOperationId);
  const expectedProvenance = {
    resolutionRequestId: providedApprovalResolutionRequestId,
    sourceOperationId: approvalSourceOperationId,
    sourceToolMessageIds: [...approvalSourceToolMessageIds].sort(),
  };
  const existingAssistant = await deps.messageModel.findById(continuationAssistantId);
  const matches =
    existingOperation?.agentId === resolvedAgentId &&
    existingOperation.topicId === topicId &&
    existingOperation.appContext?.sourceMessageId === parentMessageId &&
    matchesAgentInterventionContinuationProvenance(
      existingOperation.metadata?.agentInterventionContinuation,
      expectedProvenance,
    ) &&
    existingState.operationId === continuationOperationId &&
    existingState.metadata?.userId === deps.userId &&
    (existingState.metadata?.workspaceId ?? null) === (deps.workspaceId ?? null) &&
    existingState.metadata?.agentId === resolvedAgentId &&
    existingState.metadata?.topicId === topicId &&
    existingState.metadata?.sourceMessageId === parentMessageId &&
    matchesAgentInterventionContinuationProvenance(
      existingState.metadata?.agentInterventionContinuation,
      expectedProvenance,
    ) &&
    existingAssistant?.role === 'assistant' &&
    existingAssistant.topicId === topicId;
  if (!matches) {
    throw new Error(
      `Intervention continuation operation identity conflict: ${continuationOperationId}`,
    );
  }

  const start =
    await deps.agentRuntimeService.ensureInterventionContinuationStarted(continuationOperationId);
  if (start === 'missing') {
    throw new Error(`Intervention continuation state disappeared: ${continuationOperationId}`);
  }
  approvalClaim.continuationStarted = true;

  let gatewayToken: string | undefined;
  if (!deps.withholdGatewayToken) {
    try {
      gatewayToken = await signUserJWT(deps.userId);
    } catch {
      log('execAgent: failed to sign gateway JWT for reused intervention continuation');
    }
  }
  const now = new Date().toISOString();
  return {
    agentId: resolvedAgentId,
    assistantMessageId: continuationAssistantId,
    autoStarted: true,
    createdAt: now,
    heteroType: null,
    message: 'Agent intervention continuation already created',
    operationId: continuationOperationId,
    status: 'created',
    success: true,
    timestamp: now,
    token: gatewayToken,
    topicId,
    userMessageId: parentMessageId ?? '',
  };
};

export interface BuildApprovalResumeContextInput {
  approvalOwnerAssistantId?: string;
  approvedToolEntries: ClaimedApprovalResume['approvedToolEntries'];
  assistantMessageId: string;
  /** The base context built at step 16 — returned unchanged on a fresh send. */
  initialContext: AgentRuntimeContext;
  messageCount: number;
  operationId: string;
  parentMessageId?: string;
  resumeApproval?: InternalExecAgentParams['resumeApproval'];
  resumeApprovalPlugin?: MessagePluginItem;
  resumeApprovals?: InternalExecAgentParams['resumeApprovals'];
  resumeToolResult?: InternalExecAgentParams['resumeToolResult'];
}

/**
 * Stages 16b + 16c of {@link AiAgentService.execAgent}: override the initial
 * runtime context based on the user's decision. The DB writes in
 * {@link claimApprovalResume} have already persisted the intervention status,
 * so the message history reflects the decision for the LLM / runner on the
 * first step.
 *
 * 16b — `rejected` and `rejected_continue` share the same persisted
 * tool-result path. Starting at `tool_result` (not `user_input`) is critical
 * for a partial same-turn decision: GeneralChatAgent first checks for pending
 * siblings and re-parks them, and only the final decision continues the
 * LLM. A direct user_input continuation would fork an LLM call while the
 * unresolved tool rows were still empty.
 * Batch approval: hand the runtime every approved tool at once so it runs a
 * single `call_tools_batch` against the existing pending rows and continues
 * the LLM exactly once, with the complete result set. Taken whenever the
 * caller used the batch wire form; the single `resumeApproval` form keeps
 * the established `call_tool` + `skipCreateToolMessage` path.
 *
 * 16c — resume from the persisted tool result WITHOUT re-executing the tool.
 * Using `phase: 'tool_result'` (not `human_approved_tool`) makes the runner
 * continue the loop from the answered tool call rather than dispatching a
 * fresh `call_tool` — which would overwrite the answer with a new "pending"
 * result. Mirrors the client's tool-result-only resume path.
 */
export const buildApprovalResumeContext = (
  input: BuildApprovalResumeContextInput,
): AgentRuntimeContext => {
  const {
    approvalOwnerAssistantId,
    approvedToolEntries,
    assistantMessageId,
    messageCount,
    operationId,
    parentMessageId,
    resumeApproval,
    resumeApprovalPlugin,
    resumeApprovals,
    resumeToolResult,
  } = input;

  let initialContext = input.initialContext;

  if (resumeApprovals?.length) {
    initialContext =
      approvedToolEntries.length > 0
        ? {
            initialContext: initialContext.initialContext,
            payload: {
              approvedToolCalls: approvedToolEntries.map(({ plugin }) => ({
                apiName: plugin.apiName,
                arguments: plugin.arguments,
                id: plugin.toolCallId,
                identifier: plugin.identifier,
                type: plugin.type ?? 'default',
              })),
              assistantMessageId,
              // The tool rows already exist and are parented to the assistant that
              // emitted the calls; the batch executor addresses them through
              // `toolMessageIds` and never inserts, so this only anchors the spine.
              parentMessageId: approvalOwnerAssistantId ?? assistantMessageId,
              toolMessageIds: Object.fromEntries(
                approvedToolEntries
                  .filter(({ plugin }) => !!plugin.toolCallId)
                  .map(({ plugin, toolMessageId }) => [plugin.toolCallId!, toolMessageId]),
              ),
            } as any,
            phase: 'human_approved_tool' as const,
            session: {
              messageCount,
              sessionId: operationId,
              status: 'idle' as const,
              stepCount: 0,
            },
          }
        : {
            initialContext: initialContext.initialContext,
            payload: {
              assistantMessageId,
              parentMessageId: parentMessageId ?? resumeApprovals[0].parentMessageId,
            } as any,
            phase: 'tool_result' as const,
            session: {
              messageCount,
              sessionId: operationId,
              status: 'idle' as const,
              stepCount: 0,
            },
          };
  } else if (resumeApproval && resumeApprovalPlugin) {
    if (resumeApproval.decision === 'approved') {
      // Ask the runtime to execute the approved tool directly. Matches the
      // `phase: 'human_approved_tool'` contract used by the in-place
      // handleHumanIntervention flow — the runner generates a `call_tool`
      // instruction keyed on this payload. All tool metadata comes from
      // the plugin row fetched above; missing any of identifier/apiName
      // breaks the server-side tool executor dispatch.
      initialContext = {
        initialContext: initialContext.initialContext,
        payload: {
          approvedToolCall: {
            apiName: resumeApprovalPlugin.apiName,
            arguments: resumeApprovalPlugin.arguments,
            id: resumeApproval.toolCallId,
            identifier: resumeApprovalPlugin.identifier,
            type: resumeApprovalPlugin.type ?? 'default',
          },
          assistantMessageId,
          parentMessageId: resumeApproval.parentMessageId,
          skipCreateToolMessage: true,
        } as any,
        phase: 'human_approved_tool' as const,
        session: {
          messageCount,
          sessionId: operationId,
          status: 'idle' as const,
          stepCount: 0,
        },
      };
    } else {
      initialContext = {
        initialContext: initialContext.initialContext,
        payload: {
          assistantMessageId,
          parentMessageId: resumeApproval.parentMessageId,
        } as any,
        phase: 'tool_result' as const,
        session: {
          messageCount,
          sessionId: operationId,
          status: 'idle' as const,
          stepCount: 0,
        },
      };
    }
  }

  if (resumeToolResult) {
    initialContext = {
      initialContext: initialContext.initialContext,
      payload: {
        assistantMessageId,
        parentMessageId: resumeToolResult.parentMessageId,
      } as any,
      phase: 'tool_result' as const,
      session: {
        messageCount,
        sessionId: operationId,
        status: 'idle' as const,
        stepCount: 0,
      },
    };
  }

  return initialContext;
};
