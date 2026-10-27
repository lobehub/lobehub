import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import type { AgentRunInitRequest } from '@lobechat/types';
import debug from 'debug';

import { AgentShareModel } from '@/database/models/agentShare';
import type { AgentConfigWithId } from '@/server/services/agent';
import { applyOperationInitSlots } from '@/server/services/agentRuntime/AgentRuntimeService/operationInitSlots';
import type { MarketService } from '@/server/services/market';

import { createRunFacts, type RunFacts } from '../runFacts';
import type { AgentShareGate } from '../shareGate';
import type { ExecRunContext } from '../types';
import { type OperationInitDeps, runOperationInit } from './operationInit';
import { resolveOperationInitSlots } from './operationInitSlots';
import { createHistoryMessagesLoader } from './operationPrep';

const log = debug('lobe-server:ai-agent-service');

export type DeferredOperationInitDeps = Omit<
  OperationInitDeps,
  'getMarketService' | 'loadHistoryMessages' | 'readFileContent' | 'throwIfExecutionAborted'
> & {
  getMarketService: (runFacts: RunFacts) => Promise<MarketService>;
  /** Parse an attachment's body within what the run may read (`shareGate`, if any). */
  readFileContent: (fileId: string, shareGate?: AgentShareGate) => Promise<string | undefined>;
};

/**
 * The share a visitor run was created under, re-read from its live row: the
 * init works under the share's CURRENT grants, never a snapshot of them — the
 * same rule `createShareRunScope` follows for every visitor turn. Fails closed:
 * a share that is gone, no longer public or no longer this agent's ends the run.
 */
const resolveShareGate = async (
  deps: Pick<DeferredOperationInitDeps, 'db' | 'userId'>,
  shareVisitor: NonNullable<NonNullable<AgentState['principal']>['actor']>['shareVisitor'],
): Promise<AgentShareGate | undefined> => {
  if (!shareVisitor) return undefined;

  const share = await AgentShareModel.findByShareId(deps.db, shareVisitor.shareId);
  if (
    !share ||
    share.agentId !== shareVisitor.agentId ||
    share.ownerId !== deps.userId ||
    share.visibility !== 'link'
  ) {
    throw new Error(`Share ${shareVisitor.shareId} no longer authorizes this run`);
  }

  return {
    agentId: share.agentId,
    shareConfig: share.shareConfig,
    shareId: share.shareId,
    visitorUserId: shareVisitor.visitorUserId,
  };
};

/**
 * The run context the send path held, read back off the state the operation
 * was created with. Every field comes from the slot that already owns it; the
 * request supplies only the turn's raw ask.
 */
const restoreRunContext = async (
  deps: Pick<DeferredOperationInitDeps, 'db' | 'messageModel' | 'userId' | 'workspaceId'>,
  state: AgentState,
  request: AgentRunInitRequest,
): Promise<ExecRunContext> => {
  const origin = state.origin ?? {};
  const { lineage } = origin;
  const agentConfig = state.world?.agent as AgentConfigWithId | undefined;
  const { model, provider } = state.modelRuntimeConfig ?? {};

  if (!agentConfig || !model || !provider || !origin.topicId || !origin.assistantMessageId) {
    throw new Error(
      'Operation state lacks the agent, model, topic or assistant row a deferred init needs',
    );
  }

  // A user row exists exactly when the turn did not run from history, and the
  // turn's source message is then that row.
  const userMessageId = request.resumeFromHistory ? undefined : origin.sourceMessageId;
  // The row's metadata as persisted — what a later turn reads back from history.
  const userMessageMetadata = userMessageId
    ? ((await deps.messageModel.findById(userMessageId))?.metadata ?? undefined)
    : undefined;
  const channel = state.world?.channel;
  const deviceAccess = state.principal?.policy?.deviceAccess;

  return {
    agentConfig,
    appContext: {
      agentSignal: origin.signal,
      defaultTaskAssigneeAgentId: origin.defaultTaskAssigneeAgentId,
      documentId: origin.documentId,
      editingAgentId: origin.editingAgentId,
      editingGroupId: origin.editingGroupId,
      groupId: origin.groupId,
      isSubAgent: lineage?.isSubAgent,
      orchestrationRole: lineage?.orchestrationRole,
      projectId: origin.projectId,
      scope: origin.scope,
      sessionId: origin.sessionId,
      subAgentProgress: lineage?.progressAnchor,
      threadId: origin.threadId,
      // The caller's own value, not the resolved topic: history is read from
      // it, so a turn that opened a new topic reads none.
      topicId: request.requestedTopicId,
      viewedGoal: request.viewedGoal,
    } as ExecRunContext['appContext'],
    assistantMessageId: origin.assistantMessageId,
    botContext: state.principal?.actor?.bot,
    botPlatformContext: channel?.botPlatform,
    canUseDevice: deviceAccess?.canUseDevice ?? false,
    deviceAccessReason: deviceAccess?.reason as ExecRunContext['deviceAccessReason'],
    disabledPluginIds: state.world?.disabledPluginIds ?? [],
    discordContext: channel?.discord,
    model,
    parentMessageId: request.parentMessageId,
    persistAgentId: origin.agentId ?? agentConfig.id,
    prompt: request.prompt,
    provider,
    // `origin.agentId` names the Agent Signal target when a marker is set; the
    // agent snapshot is always the executing agent's own row.
    resolvedAgentId: agentConfig.id,
    runFacts: createRunFacts({
      db: deps.db,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    }),
    shareGate: undefined,
    topicId: origin.topicId,
    trigger: origin.trigger,
    userMessageId,
    userMessageMetadata,
  };
};

/**
 * `AgentRuntimeDelegate.runDeferredInit`: run the init an operation was created
 * without, in the step-0 worker. Rebuilds the send path's run context from the
 * state, runs the same `runOperationInit`, and writes what it produced into the
 * same slots `createOperation` would have (`applyOperationInitSlots`).
 */
export const runDeferredOperationInit = async (
  deps: DeferredOperationInitDeps,
  {
    operationId,
    request,
    state,
  }: { operationId: string; request: AgentRunInitRequest; state: AgentState },
): Promise<{ context: AgentRuntimeContext; state: Partial<AgentState> }> => {
  const ctx = await restoreRunContext(deps, state, request);
  ctx.shareGate = await resolveShareGate(deps, state.principal?.actor?.shareVisitor);

  const effectiveResume =
    !!request.resume ||
    !!request.resumeApproval ||
    !!request.resumeApprovals?.length ||
    !!request.resumeToolResult;

  const loadHistoryMessages = createHistoryMessagesLoader(
    {
      db: deps.db,
      isShareVisitorRun: !!ctx.shareGate,
      messageModel: deps.messageModel,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    },
    {
      appContext: ctx.appContext,
      effectiveResume,
      existingMessageIds: request.existingMessageIds ?? [],
      parentMessageId: request.parentMessageId,
      // Validated on the send path; history only needs to know its role.
      resumeParentMessage:
        effectiveResume && request.parentMessageId
          ? await deps.messageModel.findById(request.parentMessageId)
          : undefined,
      selfMessageIds: new Set(
        [ctx.userMessageId, ctx.assistantMessageId].filter((id): id is string => !!id),
      ),
    },
  );

  const { discovery, initialContext, prep } = await runOperationInit(
    {
      ...deps,
      getMarketService: () => deps.getMarketService(ctx.runFacts),
      loadHistoryMessages,
      readFileContent: (fileId) => deps.readFileContent(fileId, ctx.shareGate),
      // A Stop during the init is settled by the step once the init returns
      // (`runPendingInit`), so the stages need no abort probe of their own.
      throwIfExecutionAborted: async () => {},
    },
    ctx,
    request,
    operationId,
  );

  const slots = await resolveOperationInitSlots({ discovery, initialContext, prep });
  const initialized = applyOperationInitSlots(state, slots);

  // The prep appends the attachment warnings to the bot channel facts in place;
  // the send path writes that object after the init, so this one does too.
  if (ctx.botPlatformContext && initialized.world) {
    initialized.world = {
      ...initialized.world,
      channel: { ...initialized.world.channel, botPlatform: ctx.botPlatformContext },
    };
  }

  log(
    '[%s] deferred init: tools=%d, messages=%d',
    operationId,
    slots.toolSet.tools?.length ?? 0,
    slots.initialMessages?.length ?? 0,
  );

  return { context: initialContext, state: initialized };
};
