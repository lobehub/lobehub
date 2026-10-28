import type { AgentState } from '@lobechat/agent-runtime';
import { extractActivatedToolIdsFromMessages, UsageCounter } from '@lobechat/agent-runtime';

import { type OperationCreationParams } from '../types';

/**
 * What an operation's init produces: the tool surface, the assembled messages
 * and context, and the facts discovery read once for the whole run. Everything
 * else on the state is known before the init runs.
 */
export type OperationInitSlots = Pick<
  OperationCreationParams,
  | 'activeDeviceId'
  | 'activeDeviceScope'
  | 'agentGroup'
  | 'connectorOwnershipNote'
  | 'deviceSystemInfo'
  | 'executionPlan'
  | 'expertise'
  | 'initialContext'
  | 'initialMessages'
  | 'operationCredentials'
  | 'operationSkillSet'
  | 'projectInstructions'
  | 'searchDecision'
  | 'toolSet'
  | 'userMemory'
> & {
  /** The model facts discovery resolved; `model` / `provider` are known before. */
  modelCapabilities: {
    mediaCapabilities?: Record<string, boolean>;
    modelFacts?: unknown;
  };
};

/**
 * The state an operation is created with before its init runs: everything the
 * send path knows on its own. `createOperation` completes it with
 * `applyOperationInitSlots` straight away; a deferred init completes it later.
 */
export const buildPreInitState = (
  params: OperationCreationParams,
  {
    fileWorksAccepted,
    llmExecutor,
  }: {
    /** The client's `file` Works declaration, inherited by a group member. */
    fileWorksAccepted?: boolean;
    llmExecutor?: NonNullable<AgentState['host']>['llmExecutor'];
  },
): Partial<AgentState> => {
  const {
    agentConfig,
    agentShareVisitor,
    appContext,
    botContext,
    botPlatformContext,
    deviceAccessPolicy,
    disabledPluginIds,
    discordContext,
    enableExpertise,
    evalContext,
    evalRuntime,
    initialLlmCalls = 0,
    initialStepCount = 0,
    interventionResolution,
    maxSteps,
    modelRuntimeConfig,
    operationId,
    parentOperationId,
    queueRetries,
    queueRetryDelay,
    stream,
    userId,
    userInterventionConfig,
    userTimezone,
    workspaceId,
  } = params;

  return {
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    // What the host needs to deliver and retry the run. Hooks are stamped
    // right after creation once the dispatcher has serialized them.
    host: {
      ...(fileWorksAccepted === true && { acceptsFileWorks: true }),
      ...(params.clientProtocol === 2 && { clientProtocol: 2 as const }),
      ...(params.includeFinalState === true && { includeFinalState: true }),
      ...(llmExecutor && { llmExecutor }),
      queue: { retries: queueRetries, retryDelay: queueRetryDelay },
    },
    // Run ledger — everything fixed at creation lives in the typed slots.
    metadata: {},
    // Where the run came from — frozen from here on. Mirrors the
    // agent_operations row so the runtime can hang its output on the right
    // conversation node without a lookup.
    origin: {
      agentId: appContext?.agentId,
      assistantMessageId: appContext?.assistantMessageId,
      continuation: interventionResolution,
      defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
      documentId: appContext?.documentId ?? undefined,
      editingAgentId: appContext?.editingAgentId,
      editingGroupId: appContext?.editingGroupId,
      groupId: appContext?.groupId ?? undefined,
      lineage: {
        isSubAgent: appContext?.isSubAgent,
        orchestrationRole: appContext?.orchestrationRole,
        parentOperationId,
        progressAnchor: appContext?.subAgentProgress,
      },
      projectId: appContext?.projectId,
      scope: appContext?.scope ?? undefined,
      sessionId: appContext?.sessionId,
      signal: appContext?.agentSignal,
      sourceMessageId: appContext?.sourceMessageId,
      taskId: appContext?.taskId,
      threadId: appContext?.threadId ?? undefined,
      topicId: appContext?.topicId ?? undefined,
      trigger: appContext?.trigger,
      userId,
      workspaceId,
    },
    maxSteps,
    // modelRuntimeConfig at state level for executor fallback
    modelRuntimeConfig,
    operationId,
    status: 'idle',
    stepCount: initialStepCount,
    llmCalls: initialLlmCalls,
    // Compat mirror for a rolling deploy: a worker still running the
    // pre-`llmCalls` build reports only `usage.llm.apiCalls`, so a resumed
    // run that seeds its prior total here alone would lose every call made
    // before the resume the moment one of those workers finalizes it. Seeding
    // both keeps `getLlmCallCount`'s max() additive on either build.
    ...(initialLlmCalls > 0 && {
      usage: UsageCounter.accumulateAttempts(undefined, initialLlmCalls),
    }),
    // How the run executes — frozen from here on.
    plan: {
      eval: evalRuntime,
      stream,
      workingDirectory: agentConfig?.chatConfig?.runtimeEnv?.workingDirectory,
    },
    // Under whose authority the run acts and what it may do — decided here,
    // re-presented (never re-derived) at each dispatch boundary.
    principal: {
      actor: {
        bot: botContext,
        shareVisitor: agentShareVisitor,
      },
      audit: { clientIp: appContext?.clientIp, userAgent: appContext?.userAgent },
      // What the run may do, decided once here: device access and the
      // approval mode its tool calls answer to.
      policy: { deviceAccess: deviceAccessPolicy, userIntervention: userInterventionConfig },
    },
    // Compat mirrors for a rolling deploy: a worker still running the
    // pre-slot build reads only these, and a missing approval mode defaults
    // to `manual` there — which parks a headless run on an approval nobody
    // can give. Drop them (and the matching entries in
    // `normalizeAgentState`'s COMPAT_MIRROR_PATHS) once no pre-slot worker
    // can pick up a step. The `expertise` mirror is the init's.
    enableExpertise,
    userInterventionConfig,
    // What the model is told about the run's world — frozen from here on;
    // the context engine reads it on every step.
    world: {
      agent: agentConfig,
      ...((botPlatformContext || discordContext) && {
        channel: { botPlatform: botPlatformContext, discord: discordContext },
      }),
      disabledPluginIds,
      enableExpertise,
      eval: evalContext,
      userTimezone,
    },
  } as Partial<AgentState>;
};

/** The init's half of a fully-specified creation request. */
export const pickOperationInitSlots = (params: OperationCreationParams): OperationInitSlots => ({
  activeDeviceId: params.activeDeviceId,
  activeDeviceScope: params.activeDeviceScope,
  agentGroup: params.agentGroup,
  connectorOwnershipNote: params.connectorOwnershipNote,
  deviceSystemInfo: params.deviceSystemInfo,
  executionPlan: params.executionPlan,
  expertise: params.expertise,
  initialContext: params.initialContext,
  initialMessages: params.initialMessages,
  modelCapabilities: {
    mediaCapabilities: params.modelRuntimeConfig?.mediaCapabilities,
    modelFacts: params.modelRuntimeConfig?.modelFacts,
  },
  operationCredentials: params.operationCredentials,
  operationSkillSet: params.operationSkillSet,
  projectInstructions: params.projectInstructions,
  searchDecision: params.searchDecision,
  toolSet: params.toolSet,
  userMemory: params.userMemory,
});

/**
 * Write what the init produced into the state's slots. The one place that knows
 * which slot each init output lands in: `createOperation` applies it to the
 * state it is creating, and a deferred init applies it to the state the
 * operation was created with — so the two cannot drift apart.
 */
export const applyOperationInitSlots = (
  state: Partial<AgentState>,
  slots: OperationInitSlots,
): Partial<AgentState> => {
  const { toolSet: operationToolSet } = slots;
  const messages = slots.initialMessages ?? [];

  const activatableToolIds = new Set(operationToolSet.activatableToolIds ?? []);
  const restoredActivatedToolIds = extractActivatedToolIdsFromMessages(messages)?.filter((id) =>
    activatableToolIds.has(id),
  );
  const activatedStepTools = restoredActivatedToolIds?.length
    ? restoredActivatedToolIds.map((id) => ({
        activatedAtStep: state.stepCount ?? 0,
        id,
        manifest: operationToolSet.manifestMap[id],
        source: 'discovery' as const,
      }))
    : undefined;

  const { activeDeviceId, deviceSystemInfo } = slots;

  return {
    ...state,
    activatedStepTools,
    // Store initialContext for executeSync to use
    initialContext: slots.initialContext,
    messages,
    // Late-bound execution facts. The device may be unrouted here and get
    // bound at a later step boundary (`computeDeviceContext`).
    ...((activeDeviceId || deviceSystemInfo) && {
      binding: {
        ...state.binding,
        device: {
          ...state.binding?.device,
          ...(activeDeviceId && { id: activeDeviceId }),
          ...(deviceSystemInfo && { systemInfo: deviceSystemInfo }),
        },
      },
    }),
    modelRuntimeConfig: { ...state.modelRuntimeConfig, ...slots.modelCapabilities } as any,
    // Read once during discovery; dropped again as soon as the run changes
    // its own credentials (see the creds invalidation after a step).
    operationCredentials: slots.operationCredentials,
    // The run's only copy of its tool set. The manifest map is the heaviest
    // thing on the state and the state is re-serialized at every step, so the
    // former top-level mirrors (`tools`, `toolManifestMap`, `toolSourceMap`,
    // `toolExecutorMap`) are no longer written; readers go through
    // `selectToolManifestMap` and friends.
    operationToolSet,
    plan: {
      ...state.plan,
      execution: slots.executionPlan,
      skills: slots.operationSkillSet,
    },
    principal: {
      ...state.principal,
      actor: { ...state.principal?.actor, deviceScope: slots.activeDeviceScope },
    },
    // Compat mirror for a rolling deploy, see `createOperation`.
    expertise: slots.expertise,
    world: {
      ...state.world,
      connectorOwnershipNote: slots.connectorOwnershipNote,
      expertise: slots.expertise,
      group: slots.agentGroup,
      projectInstructions: slots.projectInstructions,
      searchDecision: slots.searchDecision,
      userMemory: slots.userMemory,
    },
  } as Partial<AgentState>;
};
