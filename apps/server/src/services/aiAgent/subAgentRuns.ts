import type {
  ExecAgentResult,
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
  LobeAgentChatConfig,
} from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
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
} from './hooks/threadRunHooks';
import type { InternalExecAgentParams } from './types';

const log = debug('lobe-server:ai-agent-service');

export interface SubAgentRunDeps {
  agentOperationModel: AgentOperationModel;
  agentRuntimeService: AgentRuntimeService;
  /** The facade's `execAgent` — thread runs delegate the actual turn to it. */
  execAgent: (params: InternalExecAgentParams) => Promise<ExecAgentResult>;
  messageModel: MessageModel;
  threadModel: ThreadModel;
  userId: string;
}

export interface ExecAgentThreadRunOptions {
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
  isSubAgent: boolean;
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
}

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

  // 1. Create Thread for isolated agent execution
  const thread = await deps.threadModel.create({
    agentId,
    groupId,
    sourceMessageId: parentMessageId,
    title,
    topicId,
    type: ThreadType.Isolation,
  });

  if (!thread) {
    throw new Error('Failed to create thread for agent execution');
  }

  log('%s: created thread %s', options.logScope, thread.id);

  // 2. Update Thread status to processing with startedAt timestamp
  const startedAt = new Date().toISOString();
  await deps.threadModel.update(thread.id, {
    metadata: { startedAt },
    status: ThreadStatus.Processing,
  });

  // 3. Create hooks for updating Thread metadata and source message
  const threadHooks = createThreadHooks(
    deps.agentRuntimeService,
    deps.threadModel,
    deps.messageModel,
    thread.id,
    startedAt,
    parentMessageId,
    options.logScope,
  );
  // For the virtual sub-agent path, also register the completion bridge that
  // backfills the parent's placeholder tool message and resumes the parked
  // parent op once the child run is done. Registered last so its tool-message
  // backfill (content + pluginState) is the final write.
  const hooks =
    options.resumeParentOnComplete && parentOperationId
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
  if (parentOperationId) {
    try {
      const parentOp = await deps.agentOperationModel.findById(parentOperationId);
      inheritedTrigger = parentOp?.trigger ?? undefined;
    } catch (error) {
      log('%s: failed to read parent operation trigger: %O', options.logScope, error);
    }
  }

  // Live progress for a `callSubAgent` child: its per-step totals ride down the
  // parked parent's gateway channel (see `appContext.subAgentProgress`). Group
  // members are excluded — their whole stream is already mirrored onto the
  // supervisor's channel via `mirrorToOperationId`.
  const subAgentProgress =
    options.resumeParentOnComplete && parentOperationId && options.orchestrationRole !== 'member'
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
  // Use headless mode to skip human approval in async agent execution
  const result = await deps.execAgent({
    agentId,
    appContext,
    autoStart: true,
    chatConfigOverride: options.chatConfig,
    hooks,
    // Explicit sub-agent model override resolved at the spawn site.
    model: options.model,
    parentOperationId,
    prompt: instruction,
    provider: options.provider,
    trigger: inheritedTrigger,
    userInterventionConfig: { approvalMode: 'headless' },
  });

  log(
    '%s: delegated to execAgent, operationId=%s, success=%s',
    options.logScope,
    result.operationId,
    result.success,
  );

  // 5. Store operationId in Thread metadata
  await deps.threadModel.update(thread.id, {
    metadata: { operationId: result.operationId, startedAt },
  });

  // 6. If operation failed to start, update thread status
  if (!result.success) {
    const completedAt = new Date().toISOString();
    await deps.threadModel.update(thread.id, {
      metadata: {
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
    userInterventionConfig: { approvalMode: 'headless' },
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
