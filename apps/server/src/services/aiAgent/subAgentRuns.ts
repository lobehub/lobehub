import type { AgentRunLlmExecutor } from '@lobechat/agent-runtime';
import { isCallSubAgentCall } from '@lobechat/builtin-tool-lobe-agent';
import type {
  ExecAgentResult,
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
  LobeAgentChatConfig,
  ThreadMetadata,
  UserInterventionConfig,
} from '@lobechat/types';
import {
  isAgentOperationInFlight,
  RequestTrigger,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import debug from 'debug';

import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { MessageModel } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import type {
  ExecGroupMemberParams,
  ExecGroupMemberResult,
} from '@/server/services/agentRuntime/types';

import {
  createGroupActionMemberBridgeHook,
  createSubAgentBridgeHook,
  createThreadHooks,
  pickThreadCarryOver,
  type ThreadCarryOver,
} from './hooks/threadRunHooks';
import type { SubAgentSteerOutcome } from './steerQueue/subAgent';
import type { InternalExecAgentParams } from './types';

const HEADLESS_INTERVENTION: UserInterventionConfig = { approvalMode: 'headless' };

const log = debug('lobe-server:ai-agent-service');

export interface SubAgentRunDeps {
  agentOperationModel: AgentOperationModel;
  agentRuntimeService: AgentRuntimeService;
  /** The facade's `execAgent` — thread runs delegate the actual turn to it. */
  execAgent: (params: InternalExecAgentParams) => Promise<ExecAgentResult>;
  messageModel: MessageModel;
  /** Queue an instruction behind a running sub-agent (`queueSubAgentSteer`). */
  queueSubAgentSteer: (params: {
    agentId: string;
    groupId?: string | null;
    instruction: string;
    operationId: string;
    threadId: string;
    topicId: string;
  }) => Promise<SubAgentSteerOutcome>;
  threadModel: ThreadModel;
  userId: string;
}

export interface ExecAgentThreadRunOptions {
  /**
   * Detached `callSubAgent({ runInBackground })` run. Its placeholder already
   * holds the start receipt the parent read, so the thread hooks must not
   * replace it with the answer, and nobody is listening on the parent's
   * channel for live progress.
   */
  background?: boolean;
  /**
   * Override the default sub-agent completion bridge with a custom hook
   * (e.g. the group-action member bridge for isolated executeAgentTask(s)).
   * Receives the freshly-created isolation thread id. Only used when
   * `resumeParentOnComplete` is set.
   */
  bridgeHookFactory?: (threadId: string) => AgentHook;
  /**
   * chatConfig overrides (thinking / reasoning-effort extend params) for
   * the spawned run, merged over the executing agent's own chatConfig.
   * Only set by the callSubAgent path.
   */
  chatConfig?: Partial<LobeAgentChatConfig> | null;
  /**
   * Device the spawned run inherits from its parent, forwarded to execAgent as
   * `deviceId` / `localDeviceId`. Only set by the callSubAgent path; see
   * {@link ExecVirtualSubAgentParams.deviceId}.
   */
  deviceId?: string;
  isSubAgent: boolean;
  /**
   * Relay executor for the spawned run, when the dispatching tab stands by on a
   * channel of its own (see `openSubAgentLlmRelay`). Unset, the run inherits
   * its parent's, if any.
   */
  llmExecutor?: AgentRunLlmExecutor;
  localDeviceId?: string;
  logScope: 'execSubAgent' | 'execVirtualSubAgent';
  /**
   * Explicit model/provider override for the spawned run. The callSubAgent
   * spawn site resolves the sub-agent model from the parent agent's config
   * and passes it here; left undefined for group members (they keep their
   * own model).
   */
  model?: string;
  /**
   * Marks the run's orchestration role on its operation metadata. Isolated
   * group members pass `'member'` so the inactivity-watchdog abandon path can
   * tell them apart from genuine `callSubAgent` children — both share
   * `isSubAgent: true` and an isolation thread, but a member's parent is
   * resumed through the group K=N bridge (via its own group-member timeout),
   * NOT `completeSubAgentBridge`.
   */
  orchestrationRole?: 'member';
  provider?: string;
  resumeParentOnComplete?: boolean;
  /**
   * Approval policy for the spawned run. Isolated group members inherit the
   * supervisor's; unset keeps the headless default of async sub-agent runs.
   */
  userInterventionConfig?: UserInterventionConfig;
}

type ThreadRow = NonNullable<Awaited<ReturnType<ThreadModel['findById']>>>;

/**
 * Take over an earlier `callSubAgent` isolation thread for a new turn, so the
 * same sub-agent continues on its preserved history.
 *
 * Refuses threads outside the parent's topic/agent and threads not created by
 * `callSubAgent` (group members, `callAgent` children, …). A thread whose
 * previous run is still going is not claimed: its run comes back as `running`,
 * for the caller to steer instead. The final compare-and-set claim makes
 * concurrent follow-ups to one sub-agent race-safe.
 *
 * Returns what the thread carries (its spawning tool call and the usage it
 * accumulated so far); the claim and every later write of this run carry it
 * forward instead of resetting it.
 */
const claimSubAgentThread = async (
  deps: SubAgentRunDeps,
  params: { agentId: string; startedAt: string; threadId: string; topicId: string },
): Promise<
  | { error: string }
  | { running: { operationId: string } }
  | { thread: ThreadRow; carryOver: ThreadCarryOver }
  | { claimLost: true }
> => {
  const { agentId, startedAt, threadId, topicId } = params;
  const thread = await deps.threadModel.findById(threadId);

  if (
    !thread ||
    thread.type !== ThreadType.Isolation ||
    thread.topicId !== topicId ||
    thread.agentId !== agentId
  ) {
    return {
      error: `Sub-agent "${threadId}" was not found in this conversation. subAgentId only takes the id from an earlier <sub_agent id="..." /> tag; leave it empty to start a new sub-agent.`,
    };
  }

  const sourcePlugin = thread.sourceMessageId
    ? await deps.messageModel.findMessagePlugin(thread.sourceMessageId)
    : undefined;
  if (!isCallSubAgentCall(sourcePlugin)) {
    return { error: `"${threadId}" is not a sub-agent started by callSubAgent.` };
  }

  const previousMetadata = thread.metadata as ThreadMetadata | null;
  const previousOperationId = previousMetadata?.operationId;
  const previousOperation = previousOperationId
    ? await deps.agentOperationModel.findById(previousOperationId)
    : null;
  // The operation, not the thread row's own `status`, is authoritative: the
  // inactivity watchdog abandons a stuck operation without touching its thread.
  const stillRunning = previousOperation
    ? isAgentOperationInFlight(previousOperation.status)
    : thread.status === ThreadStatus.Processing;

  if (stillRunning) {
    // A `processing` thread without an operation id names no run to queue behind.
    if (!previousOperationId) {
      return { error: `Sub-agent "${threadId}" is still starting. Try again in a moment.` };
    }
    return { running: { operationId: previousOperationId } };
  }

  const carryOver = pickThreadCarryOver(previousMetadata);
  const claimed = await deps.threadModel.claimForRun(
    thread.id,
    { operationId: previousOperationId ?? null, status: thread.status },
    { ...carryOver, startedAt },
  );

  // Another follow-up started a run on the thread first; the caller re-reads it.
  return claimed ? { thread, carryOver } : { claimLost: true };
};

const STEER_REFUSALS: Record<'full' | 'unavailable', (threadId: string) => string> = {
  full: (threadId) =>
    `Sub-agent "${threadId}" already has too many instructions waiting. Wait for its result before sending another.`,
  unavailable: (threadId) =>
    `The instruction could not be queued for sub-agent "${threadId}". Wait for its result, then send it again.`,
};

/**
 * Continue a `callSubAgent` thread with a new instruction: claim it for a new
 * run when its previous run has ended, or — while that run is still going —
 * queue the instruction behind it, to be read before its next LLM call
 * (`steered`). A run that ends while the instruction is being queued, or a
 * claim lost to a concurrent follow-up, is re-read once.
 */
const continueSubAgentThread = async (
  deps: SubAgentRunDeps,
  params: {
    agentId: string;
    groupId?: string | null;
    instruction: string;
    startedAt: string;
    threadId: string;
    topicId: string;
  },
): Promise<
  | { error: string }
  | { steered: { operationId: string } }
  | { thread: ThreadRow; carryOver: ThreadCarryOver }
> => {
  const { groupId, instruction, ...claimParams } = params;
  const { threadId } = claimParams;

  for (let attempt = 0; attempt < 2; attempt++) {
    const claim = await claimSubAgentThread(deps, claimParams);
    if ('claimLost' in claim) continue;
    if (!('running' in claim)) return claim;

    const { operationId } = claim.running;
    const outcome = await deps.queueSubAgentSteer({
      agentId: claimParams.agentId,
      groupId,
      instruction,
      operationId,
      threadId,
      topicId: claimParams.topicId,
    });
    if (outcome.queued) return { steered: { operationId } };
    if (outcome.reason !== 'ended') return { error: STEER_REFUSALS[outcome.reason](threadId) };
  }

  return {
    error: `Sub-agent "${threadId}" is busy with another instruction. Wait for its result before sending it another.`,
  };
};

/**
 * Execute an agent in an isolated Thread context: create the isolation thread,
 * register thread-lifecycle (and optionally completion-bridge) hooks, delegate
 * the turn to `execAgent`, and keep the thread row's status/metadata in sync.
 * Shared by `execSubAgent`, `execVirtualSubAgent`, and isolated group members.
 */
export const execAgentThreadRun = async (
  deps: SubAgentRunDeps,
  params: ExecSubAgentParams | ExecVirtualSubAgentParams,
  options: ExecAgentThreadRunOptions,
): Promise<ExecSubAgentResult> => {
  const { groupId, topicId, parentMessageId, agentId, instruction, title, parentOperationId } =
    params;

  log(
    '%s: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
    options.logScope,
    agentId,
    groupId,
    topicId,
    instruction.slice(0, 50),
  );

  // Dispatch beforeCallAgent hook on parent operation
  if (parentOperationId) {
    hookDispatcher
      .dispatch(parentOperationId, 'beforeCallAgent', {
        agentId,
        instruction: instruction.slice(0, 200),
        operationId: parentOperationId,
        userId: deps.userId,
      })
      .catch(() => {});
  }

  const startedAt = new Date().toISOString();
  const continueThreadId = 'threadId' in params ? params.threadId : undefined;
  let thread: ThreadRow;
  let carryOver: ThreadCarryOver = {};

  if (continueThreadId) {
    // 1-2. Continue an earlier callSubAgent thread: claim it (→ processing).
    // The new instruction lands as the next user turn on that thread, so the
    // sub-agent keeps its full history. Its original source message stays the
    // thread anchor; this run reports to the new placeholder (`parentMessageId`).
    // While its previous run is still going, the instruction steers that run.
    const claim = await continueSubAgentThread(deps, {
      agentId,
      groupId,
      instruction,
      startedAt,
      threadId: continueThreadId,
      topicId,
    });

    if ('error' in claim) {
      log('%s: cannot continue thread %s: %s', options.logScope, continueThreadId, claim.error);
      if (parentOperationId) {
        hookDispatcher
          .dispatch(parentOperationId, 'onCallAgentError', {
            agentId,
            error: claim.error,
            operationId: parentOperationId,
            userId: deps.userId,
          })
          .catch(() => {});
      }

      return {
        assistantMessageId: '',
        error: claim.error,
        operationId: '',
        success: false,
        threadId: continueThreadId,
      };
    }

    // Still running: the instruction waits in its queue and joins that run's
    // next step. No new run, so the running one keeps reporting its result.
    if ('steered' in claim) {
      log('%s: steered running thread %s', options.logScope, continueThreadId);
      return {
        assistantMessageId: '',
        operationId: claim.steered.operationId,
        steered: true,
        success: true,
        threadId: continueThreadId,
      };
    }

    thread = claim.thread;
    carryOver = claim.carryOver;
    log('%s: continuing thread %s', options.logScope, thread.id);
  } else {
    // 1. Create Thread for isolated agent execution
    const created = await deps.threadModel.create({
      agentId,
      groupId,
      sourceMessageId: parentMessageId,
      title,
      topicId,
      type: ThreadType.Isolation,
    });

    if (!created) {
      throw new Error('Failed to create thread for agent execution');
    }

    thread = created;
    log('%s: created thread %s', options.logScope, thread.id);

    // The spawning tool call marks the thread as a sub-agent in the UI; it rides
    // along on every later metadata write.
    const sourceToolCallId = 'sourceToolCallId' in params ? params.sourceToolCallId : undefined;
    if (sourceToolCallId) carryOver = { sourceToolCallId };

    // 2. Update Thread status to processing with startedAt timestamp
    await deps.threadModel.update(thread.id, {
      metadata: { ...carryOver, startedAt },
      status: ThreadStatus.Processing,
    });
  }

  const hasCompletionBridge = Boolean(options.resumeParentOnComplete && parentOperationId);
  // 3. Thread hooks always own metadata. A completion bridge exclusively owns
  // the tool result so no summary can publish before its afterToolCall control.
  const threadHooks = createThreadHooks(
    deps.agentRuntimeService,
    deps.threadModel,
    deps.messageModel,
    thread.id,
    startedAt,
    hasCompletionBridge ? undefined : parentMessageId,
    options.logScope,
    carryOver,
    { updateSourceMessage: !options.background },
  );
  // For the virtual sub-agent path, also register the completion bridge that
  // backfills the parent's placeholder tool message and resumes the parked
  // parent op once the child run is done.
  const hooks =
    hasCompletionBridge && parentOperationId
      ? [
          ...threadHooks,
          options.bridgeHookFactory
            ? options.bridgeHookFactory(thread.id)
            : createSubAgentBridgeHook(
                deps.agentRuntimeService,
                parentOperationId,
                parentMessageId,
                thread.id,
              ),
        ]
      : threadHooks;

  // Inherit parent op's trigger so sub-agent rows stay attributable to the
  // original entry point (chat / bot / cli / eval / …). Lookup is best-effort
  // — a missing parent row falls back to undefined and the column stays null.
  let inheritedTrigger: string | undefined;
  // A tab that dispatches a direct @mention passes its own client-local
  // operation id, which has no server row. The child must not record it as its
  // parent: gateway authorization only admits a child whose recorded parent is
  // a live server run, so the child would fail with UNAUTHORIZED.
  let recordedParentOperationId = parentOperationId;
  if (parentOperationId) {
    try {
      const parentOp = await deps.agentOperationModel.findById(parentOperationId);
      inheritedTrigger = parentOp?.trigger ?? undefined;
      if (!parentOp) {
        recordedParentOperationId = undefined;
        // Only the chat UI dispatches from a tab-local operation.
        inheritedTrigger = RequestTrigger.Chat;
      }
    } catch (error) {
      log('%s: failed to read parent operation trigger: %O', options.logScope, error);
    }
  }

  // Live progress for a `callSubAgent` child: its per-step totals ride down the
  // parked parent's gateway channel (see `appContext.subAgentProgress`). Group
  // members are excluded — their whole stream is already mirrored onto the
  // supervisor's channel via `mirrorToOperationId`.
  const subAgentProgress =
    options.resumeParentOnComplete &&
    parentOperationId &&
    options.orchestrationRole !== 'member' &&
    !options.background
      ? { parentOperationId, toolMessageId: parentMessageId }
      : undefined;

  const appContext: NonNullable<InternalExecAgentParams['appContext']> = {
    groupId,
    // Every run spawned here executes in an isolation thread on the SPAWNER's
    // topic, so it must not touch that topic's `runningOperation` mark — that
    // mark is the main run's reconnect anchor (see execAgent).
    isolationThread: true,
    isSubAgent: options.isSubAgent,
    orchestrationRole: options.orchestrationRole,
    subAgentProgress,
    threadId: thread.id,
    topicId,
  };

  // 4. Delegate to execAgent with threadId in appContext and hooks
  // The instruction will be created as user message in the Thread
  // Headless (skip human approval) unless the caller hands down the parent's
  // policy — isolated group members answer to the supervisor's approval mode.
  let result: ExecAgentResult;
  try {
    result = await deps.execAgent({
      agentId,
      appContext,
      autoStart: true,
      chatConfigOverride: options.chatConfig,
      deviceId: options.deviceId,
      hooks,
      ...(options.llmExecutor && { llmExecutor: options.llmExecutor }),
      localDeviceId: options.localDeviceId,
      // Explicit sub-agent model override resolved at the spawn site.
      model: options.model,
      parentOperationId: recordedParentOperationId,
      prompt: instruction,
      provider: options.provider,
      trigger: inheritedTrigger,
      userInterventionConfig: options.userInterventionConfig ?? HEADLESS_INTERVENTION,
    });
  } catch (error) {
    // Without an operation id a `processing` thread reads as "still running"
    // forever, which would lock the sub-agent against any later follow-up.
    await deps.threadModel
      .update(thread.id, {
        metadata: {
          ...carryOver,
          completedAt: new Date().toISOString(),
          error: String(error),
          startedAt,
        },
        status: ThreadStatus.Failed,
      })
      .catch((updateError) =>
        log(
          '%s: failed to mark thread %s failed after execAgent threw: %O',
          options.logScope,
          thread.id,
          updateError,
        ),
      );
    throw error;
  }

  log(
    '%s: delegated to execAgent, operationId=%s, success=%s',
    options.logScope,
    result.operationId,
    result.success,
  );

  // 5. Store operationId in Thread metadata
  await deps.threadModel.update(thread.id, {
    metadata: { ...carryOver, operationId: result.operationId, startedAt },
  });

  // 6. If operation failed to start, update thread status
  if (!result.success) {
    const completedAt = new Date().toISOString();
    await deps.threadModel.update(thread.id, {
      metadata: {
        ...carryOver,
        completedAt,
        duration: Date.now() - new Date(startedAt).getTime(),
        error: result.error,
        operationId: result.operationId,
        startedAt,
      },
      status: ThreadStatus.Failed,
    });

    // Dispatch onCallAgentError hook
    if (parentOperationId) {
      hookDispatcher
        .dispatch(parentOperationId, 'onCallAgentError', {
          agentId,
          error: result.error || 'Sub-agent execution failed',
          operationId: parentOperationId,
          userId: deps.userId,
        })
        .catch(() => {});
    }
  } else if (parentOperationId) {
    // Dispatch afterCallAgent hook
    hookDispatcher
      .dispatch(parentOperationId, 'afterCallAgent', {
        agentId,
        operationId: parentOperationId,
        subOperationId: result.operationId,
        success: true,
        threadId: thread.id,
        userId: deps.userId,
      })
      .catch(() => {});
  }

  return {
    assistantMessageId: result.assistantMessageId,
    error: result.error,
    operationId: result.operationId,
    success: result.success ?? false,
    threadId: thread.id,
    // The child's own gateway ticket: a tab that dispatched it has no server
    // run whose channel would carry the child's progress, so it subscribes here.
    ...(result.token && { token: result.token }),
  };
};

/**
 * Run a group member in the shared group session (non-isolated). The member's
 * turns land directly in the group conversation; the supervisor's instruction
 * is injected as a `<speaker name="Supervisor" />`-tagged prompt. Registers the
 * group-action member bridge that backfills the member anchor and
 * resumes/finishes the parked supervisor once the K=N member barrier passes.
 */
export const execAgentMember = async (
  deps: SubAgentRunDeps,
  params: ExecGroupMemberParams,
): Promise<ExecGroupMemberResult> => {
  const {
    agentId,
    anchorMessageId,
    disableTools,
    expectedMembers,
    groupId,
    groupToolMessageId,
    instruction,
    onComplete,
    parentOperationId,
    supervisorMessageId,
    topicId,
  } = params;

  log(
    'execAgentMember: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
    agentId,
    groupId,
    topicId,
    (instruction ?? '').slice(0, 50),
  );

  // Dispatch beforeCallAgent hook on the supervisor operation.
  hookDispatcher
    .dispatch(parentOperationId, 'beforeCallAgent', {
      agentId,
      instruction: (instruction ?? '').slice(0, 200),
      operationId: parentOperationId,
      userId: deps.userId,
    })
    .catch(() => {});

  // Inherit the supervisor op's trigger so member rows stay attributable.
  let inheritedTrigger: string | undefined;
  try {
    const parentOp = await deps.agentOperationModel.findById(parentOperationId);
    inheritedTrigger = parentOp?.trigger ?? undefined;
  } catch (error) {
    log('execAgentMember: failed to read parent operation trigger: %O', error);
  }

  const speakerInstruction = instruction
    ? `<speaker name="Supervisor" />\n${instruction}`
    : 'Please respond to the group conversation based on the current context.';

  const appContext: NonNullable<InternalExecAgentParams['appContext']> = {
    groupId,
    orchestrationRole: 'member',
    scope: 'group',
    topicId,
  };

  // The member runs as a child op of the supervisor and lands its turns in the
  // shared group conversation (no isolation thread). The bridge backfills the
  // member anchor (a short receipt) and resumes/finishes the supervisor.
  //
  // The member response attaches to the SUPERVISOR ASSISTANT message that owns
  // this group-management tool call (`supervisorMessageId`), NOT to the tool
  // message. For a multi-member broadcast the member assistants are therefore
  // siblings of the `agentCouncil` tool under one supervisor turn, and the
  // renderer groups them into a single parallel-streaming council card. The tool
  // message stays a pure result and the per-member anchors stay under it for the
  // K=N barrier only. This keeps the tool node clean and lets parallel speak/
  // broadcast turns render without the UI discontinuity the old tool-parented
  // shape caused. Falls back to the group tool message if no supervisor id was
  // threaded through (e.g. single-member collapses onto the tool anyway).
  //
  // The supervisor instruction is injected as an EPHEMERAL user message
  // (`suppressUserMessage` + `ephemeralUserMessage`): it drives the member's
  // response but is NOT persisted as a `role: 'user'` row, mirroring the
  // client orchestration where the supervisor instruction is virtual. Without
  // this, every server-side speak/broadcast/delegate would leak the
  // orchestration prompt into the group conversation as a real message.
  const result = await deps.execAgent({
    agentId,
    appContext,
    autoStart: true,
    disableTools,
    ephemeralUserMessage: speakerInstruction,
    hooks: [
      createGroupActionMemberBridgeHook(deps.agentRuntimeService, {
        anchorMessageId,
        expectedMembers,
        groupToolMessageId,
        mode: 'in_group',
        onComplete,
        parentOperationId,
      }),
    ],
    parentMessageId: supervisorMessageId ?? groupToolMessageId,
    parentOperationId,
    prompt: speakerInstruction,
    suppressUserMessage: true,
    topicStartOwnerOperationId: parentOperationId,
    trigger: inheritedTrigger,
    // The member answers to the approval mode the user picked for the turn: a
    // hard-coded headless let members silently run `humanIntervention:
    // 'required'` tools that the supervisor itself would have to ask for.
    userInterventionConfig: params.userInterventionConfig ?? HEADLESS_INTERVENTION,
  });

  log(
    'execAgentMember: delegated to execAgent, operationId=%s, success=%s',
    result.operationId,
    result.success,
  );

  return {
    error: result.error,
    operationId: result.operationId,
    started: result.success ?? false,
  };
};

/**
 * Run a group member in its own isolation thread under the supervisor's topic.
 * Installs the group-action member bridge and, when the member has a timeout,
 * arms the watchdog that ends it at the deadline.
 */
export const execIsolatedAgentMember = async (
  deps: SubAgentRunDeps,
  params: ExecGroupMemberParams,
): Promise<ExecGroupMemberResult> => {
  // Isolated members reuse the sub-agent isolation-thread machinery, swapping
  // in the group-action member bridge (K=N barrier + resume/finish).
  const deadlineAt = params.timeout && params.timeout > 0 ? Date.now() + params.timeout : undefined;
  const result = await execAgentThreadRun(
    deps,
    {
      agentId: params.agentId,
      groupId: params.groupId,
      instruction: params.instruction ?? 'Please complete the assigned task.',
      parentMessageId: params.anchorMessageId,
      parentOperationId: params.parentOperationId,
      timeout: params.timeout,
      title: params.instruction?.slice(0, 50),
      topicId: params.topicId,
    },
    {
      bridgeHookFactory: (threadId) =>
        createGroupActionMemberBridgeHook(deps.agentRuntimeService, {
          anchorMessageId: params.anchorMessageId,
          deadlineAt,
          expectedMembers: params.expectedMembers,
          groupToolMessageId: params.groupToolMessageId,
          mode: 'isolated',
          onComplete: params.onComplete,
          parentOperationId: params.parentOperationId,
          threadId,
        }),
      isSubAgent: true,
      logScope: 'execVirtualSubAgent',
      // Tag the op as a group member so the abandon path routes its parent
      // resume through the group bridge (its own timeout), not the sub-agent one.
      orchestrationRole: 'member',
      resumeParentOnComplete: true,
      userInterventionConfig: params.userInterventionConfig,
    },
  );

  // Enforce the requested timeout: if the member op is still running when the
  // deadline passes, the watchdog interrupts it and bridges a `timeout`
  // completion so the supervisor doesn't stay parked indefinitely.
  if (result.success && result.operationId && params.timeout && params.timeout > 0) {
    await deps.agentRuntimeService.scheduleGroupMemberTimeout(
      {
        anchorMessageId: params.anchorMessageId,
        expectedMembers: params.expectedMembers,
        groupToolMessageId: params.groupToolMessageId,
        memberOperationId: result.operationId,
        mode: 'isolated',
        onComplete: params.onComplete,
        parentOperationId: params.parentOperationId,
      },
      params.timeout,
    );
  }

  return {
    error: result.error,
    operationId: result.operationId,
    started: result.success ?? false,
    threadId: result.threadId,
  };
};
