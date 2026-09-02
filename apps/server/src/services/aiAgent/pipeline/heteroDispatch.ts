import { LOADING_FLAT } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import {
  HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
  isLocalHeterogeneousType,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import type {
  ErrorType,
  ExecAgentResult,
  HeterogeneousTopicModel,
  LobeAgentAgencyConfig,
  RequestTrigger,
  WorkingDirConfig,
} from '@lobechat/types';
import {
  applyTopicModelToHeterogeneousProvider,
  buildHeteroExecArgs,
  ChatErrorType,
  getWorkingDirEffectivePath,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { DeviceModel } from '@/database/models/device';
import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { resolveExecutionPlan, resolveWorkspaceScoped } from '@/helpers/executionTarget';
import { signHeteroOperationJWT, signUserJWT } from '@/libs/trpc/utils/internalJwt';
import {
  createAgentStateManager,
  createStreamEventManager,
} from '@/server/modules/AgentRuntime/factory';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { deviceGateway } from '@/server/services/deviceGateway';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import type { ConversationHistoryEntry } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import { buildCloudHeteroContext } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import { buildRemoteDeviceHeteroContext } from '@/server/services/heterogeneousAgent/remoteDeviceHeteroContext';
import type { MarketService } from '@/server/services/market';

import {
  getHeterogeneousAgentTitle,
  humanizeHeteroDispatchError,
  resolveHeteroDispatchErrorType,
  supportsCloudHeterogeneousSandbox,
} from '../helpers/heteroErrors';
import { resolveDeviceWorkingDirectoryConfig } from '../resolveDeviceWorkingDirectory';
import type { ExecRunContext } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface HeteroDispatchDeps {
  bindTopicWorkingDirectory: (params: {
    config?: WorkingDirConfig;
    currentWorkingDirectory?: string;
    topicId: string;
  }) => Promise<void>;
  db: LobeChatDatabase;
  getMarketService: () => Promise<MarketService>;
  messageModel: MessageModel;
  resolveDeviceWorkspaceId: (deviceId: string | undefined) => Promise<string | undefined>;
  topicModel: TopicModel;
  userId: string;
  withholdGatewayToken: boolean;
  workspaceId?: string;
}

/**
 * Finalize a hetero run that fails *synchronously at dispatch* — before the
 * CLI/agent process ever starts (device offline → DEVICE_NOT_FOUND, no bound
 * device, access denied, sandbox spawn rejected). These paths never produce a
 * `heteroFinish` (CLI exit) or `agentNotify` done callback, so without this
 * each one would strand the run: the assistant bubble would show an error but
 * the UI stream would never close and a long-run task would hang in `running`.
 *
 * Routes through the SAME terminal funnel a normal exit uses —
 * `CompletionLifecycle.completeOperation` finalizes the op row and fires the
 * run's onComplete/onError hooks, so the task lifecycle (onTopicComplete → task
 * failed) and any IM bot completion callback fire exactly as they would for a
 * real failure — then closes the UI stream and clears the (never-started)
 * running operation. The hooks were registered and serialized onto
 * `runningOperation` at dispatch time.
 *
 * Stream-close / hook dispatch / metadata clear are best-effort: a failure
 * there must not mask the original dispatch error the caller surfaces.
 */
const finalizeHeteroDispatchError = async (
  deps: HeteroDispatchDeps,
  params: {
    agentId?: string;
    assistantMessageId: string;
    detail: string;
    /**
     * Client error type. Defaults to the generic `ServerAgentRuntimeError`; pass a
     * dedicated `ChatErrorType` (e.g. `DeviceGatewayNotConfigured`) so the web
     * client renders a specific localized headline instead of the generic copy.
     */
    errorType?: ErrorType;
    message: string;
    operationId: string;
    topicId: string;
  },
): Promise<void> => {
  const {
    agentId,
    assistantMessageId,
    detail,
    errorType = ChatErrorType.ServerAgentRuntimeError,
    message,
    operationId,
    topicId,
  } = params;

  // 1. Error bubble — written first so a stream subscriber reacting to the
  //    end event below re-reads a message that already carries the error.
  await deps.messageModel.update(assistantMessageId, {
    content: '',
    error: { body: { detail }, message, type: errorType },
  });

  // 1b. Finalize the run through CompletionLifecycle's single entry — the SAME
  //     owner the CLI exit (heteroFinish) / in-process paths use. It marks the
  //     agent_operations row terminal (the row was inserted at recordStart, but a
  //     dispatch failure goes through THIS path, not heteroFinish, so without
  //     finalizing it the row stays status='running' forever) AND fires the run's
  //     onComplete/onError hooks (task lifecycle → task failed + IM bot callback).
  //     `skipErrorMessageWrite` keeps the bespoke device-specific bubble written
  //     in step 1; verify is done-only, so it no-ops on this error path.
  await new CompletionLifecycle(deps.db, deps.userId, deps.workspaceId).completeOperation(
    {
      agentId,
      assistantMessageId,
      error: { message, type: errorType },
      operationId,
      serializedHooks: hookDispatcher.getSerializedHooks(operationId),
      topicId,
      userId: deps.userId,
    },
    'error',
    { skipErrorMessageWrite: true },
  );

  // 2. Close the UI stream.
  try {
    await createStreamEventManager().publishAgentRuntimeEnd({
      finalState: { error: detail },
      operationId,
      reason: 'error',
      reasonDetail: detail,
      stepIndex: 0,
    });
  } catch (err) {
    log('finalizeHeteroDispatchError: publishAgentRuntimeEnd failed (non-fatal): %O', err);
  }

  // 3. The operation never started — settle the topic so reconnect /
  //    heteroIngest validation and the next turn don't see a stale operation.
  //    Settle, not take: dropping the marker alone would strand `status` on
  //    'running' with nothing left for any later settle to match — see
  //    `ServerOperationStore.clearRunningMark`. 'active' rather than 'unread'
  //    because a dispatch that never started produced nothing to read.
  try {
    await deps.topicModel.settleRunningOperation(topicId, operationId, 'active');
  } catch (err) {
    log('finalizeHeteroDispatchError: clear runningOperation failed (non-fatal): %O', err);
  }
};

export interface HeteroDispatchInput {
  canManageAgent: boolean;
  effectiveRequestedDeviceId?: string;
  heterogeneousProvider?: LobeAgentAgencyConfig['heterogeneousProvider'];
  heteroType: HeterogeneousAgentType;
  hooks?: AgentHook[];
  isPublicWorkspaceAgent: boolean;
  localDeviceId?: string;
  maxSteps?: number;
  memberDeviceOverride?: Pick<LobeAgentAgencyConfig, 'boundDeviceId' | 'executionTarget'>;
  operationTaskId?: string;
  parentOperationId?: string;
  pinnedHeterogeneousTopicModel?: HeterogeneousTopicModel;
  requestedDeviceId?: string;
  requestTrigger?: RequestTrigger;
  runAttachments: { imageList?: Array<{ alt: string; id: string; url: string }> };
  /** Ids of the rows THIS turn just persisted (excluded from recovery history). */
  selfMessageIds: Set<string>;
  topicStartOwnerOperationId?: string;
}

/**
 * Stage 3.5 of {@link AiAgentService.execAgent}: heterogeneous-agent early
 * exit. Local CLI and remote platform agents bypass the server-side LLM
 * pipeline — after topic + message creation we hand off to the device gateway
 * (desktop) or cloud sandbox, which will push events back via `heteroIngest` /
 * `heteroFinish` (amp / claude-code / codebuddy / codex / cursor / droid /
 * grok-build / kimi-code / opencode / pi / qoder / trae) or
 * `agentNotify.notify` (openclaw / hermes).
 *
 * Always returns a terminal {@link ExecAgentResult} — the caller's `execAgent`
 * returns it directly and never continues to the normal-agent stages.
 */
export const dispatchHeteroAgent = async (
  deps: HeteroDispatchDeps,
  ctx: ExecRunContext,
  input: HeteroDispatchInput,
): Promise<ExecAgentResult> => {
  const {
    agentConfig,
    appContext,
    assistantMessageId,
    canUseDevice,
    deviceAccessReason,
    parentMessageId,
    persistAgentId,
    prompt,
    resolvedAgentId,
    topicId,
    trigger,
    userMessageId,
  } = ctx;
  const {
    canManageAgent,
    effectiveRequestedDeviceId,
    heteroType,
    heterogeneousProvider,
    hooks,
    isPublicWorkspaceAgent,
    localDeviceId,
    maxSteps,
    memberDeviceOverride,
    operationTaskId,
    parentOperationId,
    pinnedHeterogeneousTopicModel,
    requestTrigger,
    requestedDeviceId,
    runAttachments,
    selfMessageIds,
    topicStartOwnerOperationId,
  } = input;

  const isRemoteHetero = isRemoteHeterogeneousType(heteroType);
  // Same structured shape as the built-in path (`op_{ts}_{agentId}_{topicId}_{rand}`)
  // so hetero ops aren't visually distinct bare nanoids in the trace/op tables.
  const operationId = `op_${Date.now()}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

  // Persist a first-class agent_operations row for the hetero run. The id is
  // generated here (authoritative) and flows through to heteroIngest /
  // heteroFinish unchanged. Without this row the run is invisible to the
  // operation lifecycle: verify (ensureForOperation), repair (parent chain),
  // judge (op.model/provider) and tracing all key off it. The durable row is
  // also an authentication prerequisite: every callback
  // re-authorizes its operation token against this exact principal. Do not
  // mint a token or dispatch/spawn when persistence fails.
  const operationPersisted = await new CompletionLifecycle(
    deps.db,
    deps.userId,
    deps.workspaceId,
  ).recordStart({
    agentId: persistAgentId,
    chatGroupId: appContext?.groupId ?? null,
    maxSteps,
    operationId,
    parentOperationId,
    provider: heteroType,
    taskId: operationTaskId ?? null,
    threadId: appContext?.threadId ?? null,
    topicId,
    trigger,
  });
  if (!operationPersisted) {
    throw new Error('Failed to persist heterogeneous agent operation');
  }

  // Read resume session id for next-turn continuity.
  const heteroService = new HeterogeneousAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const resumeSessionId = await heteroService.getHeterogeneousResumeSessionId(topicId);
  // Sign an operation-scoped JWT so the CLI can authenticate against
  // heteroIngest / heteroFinish without full user credentials.
  let operationJwt: string;
  try {
    operationJwt = await signHeteroOperationJWT({
      capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
      operationId,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    });
  } catch (err) {
    log('execAgent: failed to sign operation JWT for hetero run: %O', err);
    throw new Error('Failed to sign operation JWT for hetero agent', { cause: err });
  }

  // Read repos from topic metadata for sandbox setup (web/cloud only).
  const topic = await deps.topicModel.findById(topicId);
  const topicRepos: string[] = topic?.metadata?.repos ?? [];

  // Resolve GitHub OAuth token for the sandbox. Always attempt so CC can use
  // git / gh CLI even when no repos are pre-selected. Falls back to the
  // standard 'github' key (LobeHub OAuth connector default); agent config can
  // override via GITHUB_CRED_KEY.
  let githubToken: string | undefined;
  const githubCredKey =
    agentConfig.agencyConfig?.heterogeneousProvider?.env?.GITHUB_CRED_KEY ?? 'github';
  try {
    const marketService = await deps.getMarketService();
    // Inside a workspace, the GitHub cred must come from the workspace's shared
    // organization credentials, not the operator's personal creds.
    const credsAccessor = deps.workspaceId
      ? marketService.market.organizations.creds({ workspaceId: deps.workspaceId })
      : marketService.market.creds;
    const list = await credsAccessor.list();
    const cred = list.data?.find((c: { key: string }) => c.key === githubCredKey);
    if (cred) {
      const full = await credsAccessor.get(cred.id, { decrypt: true });
      const vals = (full as any).plaintext ?? (full as any).values ?? {};
      githubToken = vals.access_token ?? vals.token;
    }
  } catch (err) {
    log('execAgent: failed to resolve GitHub token: %O', err);
  }

  // Recovery history is reserved for the CLI's retry without native resume.
  // The primary resumed attempt already has native history and must not get
  // a serialized duplicate. Amp threads are server-backed, so they rely on
  // native continuation exclusively and never need this local-file fallback.
  let conversationHistory: ConversationHistoryEntry[] | undefined;
  if (heteroType !== 'amp') {
    try {
      const recentMsgs = await deps.messageModel.query({ topicId, pageSize: 200 });
      const turns = recentMsgs
        .filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            !m.threadId &&
            !selfMessageIds.has(m.id) &&
            m.content &&
            m.content !== LOADING_FLAT,
        )
        .slice(-30)
        .map((m) => ({
          content: m.content ?? '',
          role: m.role as 'assistant' | 'user',
        }));
      if (turns.length > 0) conversationHistory = turns;
    } catch (err) {
      log('execAgent: failed to load conversation history for hetero context: %O', err);
    }
  }

  // Build the primary context without conversation history. If native resume
  // fails, the CLI switches to the complete fallback prompt on its fresh
  // retry; successful same-session runs never consume the duplicate history.
  const systemContext = buildCloudHeteroContext({
    agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
    conversationHistory: resumeSessionId ? undefined : conversationHistory,
    githubToken,
    repos: topicRepos,
  });
  const resumeFallbackSystemContext =
    resumeSessionId && conversationHistory
      ? buildCloudHeteroContext({
          agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
          conversationHistory,
          githubToken,
          repos: topicRepos,
        })
      : undefined;

  // Feed the resolved images (signed URLs) to the dispatched CLI for vision —
  // mirrors the local-mode path, where the client feeds the persisted
  // message's imageList into `sendPrompt`. Reuses the shared resolution above
  // so bot/IM and SPA gateway attachments are handled identically.
  const heteroImageList =
    runAttachments.imageList && runAttachments.imageList.length > 0
      ? runAttachments.imageList.map((image) => ({ id: image.id, url: image.url }))
      : undefined;
  const heteroExecArgs = isLocalHeterogeneousType(heteroType)
    ? buildHeteroExecArgs(
        heterogeneousProvider?.type === heteroType
          ? applyTopicModelToHeterogeneousProvider(
              heterogeneousProvider,
              pinnedHeterogeneousTopicModel,
            )
          : { type: heteroType },
      )
    : undefined;

  const heteroParams = {
    agentType: heteroType,
    assistantMessageId,
    githubToken,
    imageList: heteroImageList,
    jwt: operationJwt,
    operationId,
    prompt,
    repos: topicRepos,
    resumeFallbackSystemContext,
    resumeSessionId,
    systemContext,
    topicId,
    userId: deps.userId,
  };

  const platformPlan = isRemoteHetero
    ? resolveExecutionPlan({
        agencyConfig: agentConfig.agencyConfig,
        canUseDevice,
        clientExecutionAvailable: Boolean(localDeviceId),
        isHetero: true,
        localDeviceId,
        requestedDeviceId: effectiveRequestedDeviceId,
        sandboxExecutionAvailable: false,
        trigger: requestTrigger,
        workspaceScoped: resolveWorkspaceScoped(
          isPublicWorkspaceAgent && !canManageAgent,
          memberDeviceOverride,
        ),
      })
    : undefined;
  const remoteDeviceId = platformPlan?.kind === 'device' ? platformPlan.deviceId : undefined;
  const remoteDeviceWorkspaceId = remoteDeviceId
    ? await deps.resolveDeviceWorkspaceId(remoteDeviceId)
    : undefined;
  const usesCallersPersonalDevice =
    platformPlan?.kind === 'device' &&
    !remoteDeviceWorkspaceId &&
    (effectiveRequestedDeviceId === remoteDeviceId ||
      (platformPlan.target === 'local' &&
        agentConfig.agencyConfig?.executionTargetSelectionPolicy !== 'fixed') ||
      (!canManageAgent && memberDeviceOverride?.boundDeviceId === remoteDeviceId));
  const remoteDeviceUserId = usesCallersPersonalDevice
    ? deps.userId
    : (agentConfig.userId ?? deps.userId);

  // Register the run's lifecycle hooks so the hetero terminal path fires
  // onComplete/onError through the same `hookDispatcher` the normal LLM
  // runtime uses — driving the task lifecycle (onTopicComplete) and IM bot
  // completion callbacks uniformly. The hetero block returns before
  // AgentRuntimeService (which registers hooks for normal runs), so we do it
  // here. Local mode dispatches these in-memory handlers; queue mode
  // delivers the serialized webhooks persisted on runningOperation below.
  if (hooks?.length) hookDispatcher.register(operationId, hooks);
  const serializedHooks = hookDispatcher.getSerializedHooks(operationId);

  // Seed topic.metadata.runningOperation so heteroIngest can validate the
  // operation, and so every terminal site (heteroFinish, agentNotify done,
  // dispatch failure) can re-fire the serialized hooks across a process
  // boundary in queue mode.
  const childOperation = {
    assistantMessageId,
    heteroType,
    hooks: serializedHooks,
    startedAt: new Date().toISOString(),
    ...(isRemoteHetero && remoteDeviceId
      ? {
          deviceId: remoteDeviceId,
          deviceUserId: remoteDeviceUserId,
          deviceWorkspaceId: remoteDeviceWorkspaceId,
        }
      : {}),
    operationId,
    orchestrationRole: appContext?.orchestrationRole,
    scope: appContext?.scope ?? undefined,
    threadId: appContext?.threadId ?? undefined,
  };
  if (topicStartOwnerOperationId) {
    const attached = await deps.topicModel.appendRunningOperationChild(
      topicId,
      topicStartOwnerOperationId,
      childOperation,
    );
    if (!attached) {
      const message = 'Group supervisor finished before this member could start.';
      await new CompletionLifecycle(deps.db, deps.userId, deps.workspaceId).completeOperation(
        {
          agentId: persistAgentId,
          assistantMessageId,
          error: { message, type: 'AgentRuntimeError' },
          operationId,
          orchestrationRole: appContext?.orchestrationRole,
          serializedHooks,
          topicId,
          userId: deps.userId,
        },
        'error',
      );
      return {
        agentId: resolvedAgentId,
        assistantMessageId,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: message,
        message,
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageId ?? parentMessageId ?? '',
      };
    }
  } else if (appContext?.isolationThread && parentOperationId) {
    // Isolation-thread children (callAgent / callSubAgent) run on the
    // SPAWNER's topic and finish long before it does. heteroIngest and
    // heteroFinish both require this child's operationId to resolve via
    // topic.metadata.runningOperation (root or childOperations) — see
    // the comment above childOperation — or every streamed batch is
    // dropped as stale and the terminal onComplete hooks (including the
    // callAgent resume bridge) never fire. Nest under the parent's own
    // marker instead of claiming the topic-level root outright, so the
    // parent's marker survives for the rest of its still-running turn.
    const attachedToParent = await deps.topicModel.appendRunningOperationChild(
      topicId,
      parentOperationId,
      childOperation,
    );
    if (!attachedToParent) {
      // Parent isn't (or is no longer) the topic's current root marker —
      // e.g. a nested isolation chain, or the parent already settled.
      // Fall back to claiming the marker directly so this child is still
      // discoverable by its own operationId, rather than permanently
      // unrecognized by heteroIngest/heteroFinish.
      await deps.topicModel.updateMetadata(topicId, { runningOperation: childOperation });
    }
  } else if (!appContext?.isolationThread) {
    await deps.topicModel.updateMetadata(topicId, { runningOperation: childOperation });
  }

  // Always persist operation metadata (userId/workspaceId) to the state
  // manager, not just for topic-owner-mirrored runs. `subAgentCallback`
  // (the QStash-delivered completion bridge for callAgent/callSubAgent
  // children) resolves `userId` from this same store to authorize
  // resuming the parent — without it, a hetero child spawned via
  // callAgent has no metadata row, the callback 401s, and the parent
  // operation is never resumed (stays parked until the inactivity
  // watchdog abandons it).
  const persistOperationMetadata = async () => {
    try {
      await createAgentStateManager().createOperationMetadata(operationId, {
        ...(topicStartOwnerOperationId && {
          mirrorToOperationId: topicStartOwnerOperationId,
        }),
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      });
    } catch (err) {
      log('execAgent: failed to persist hetero operation metadata: %O', err);
    }
  };

  if (agentConfig.agencyConfig?.heterogeneousProvider?.authMode === 'api') {
    await finalizeHeteroDispatchError(deps, {
      agentId: resolvedAgentId,
      assistantMessageId,
      detail: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
      message: 'Provider-bound heterogeneous agents do not support this execution target',
      operationId,
      topicId,
    });
    return {
      agentId: resolvedAgentId,
      assistantMessageId,
      autoStarted: false,
      createdAt: new Date().toISOString(),
      error: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
      message: 'Heterogeneous agent provider binding requires Desktop local execution',
      operationId,
      status: 'error',
      success: false,
      timestamp: new Date().toISOString(),
      topicId,
      userMessageId: userMessageId ?? parentMessageId ?? '',
    };
  }

  // Notify-based platform agents (openclaw / hermes) communicate back via
  // agentNotify.notify. A local run uses the requesting desktop's device ID;
  // a remote run uses agencyConfig.boundDeviceId. Both use the gateway transport,
  // so open the stream before the first notify arrives.

  if (isRemoteHetero) {
    // Platform task agents require either this desktop or a connected device — there is no sandbox to
    // degrade to, so a denied sender (external bot user) is refused
    // outright instead of reaching the owner's machine.
    if (!canUseDevice) {
      log(
        'execAgent: device access denied for remote hetero dispatch (reason=%s)',
        deviceAccessReason,
      );
      await finalizeHeteroDispatchError(deps, {
        agentId: resolvedAgentId,
        assistantMessageId,
        detail: 'This sender is not allowed to run agents on a bound device.',
        message: 'Device access denied',
        operationId,
        topicId,
      });
      return {
        agentId: resolvedAgentId,
        assistantMessageId,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'Device access denied',
        message: 'Remote hetero agent requires device access',
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageId ?? parentMessageId ?? '',
      };
    }
    if (!remoteDeviceId) {
      log('execAgent: openclaw/hermes requires a local or connected device');
      await finalizeHeteroDispatchError(deps, {
        agentId: resolvedAgentId,
        assistantMessageId,
        detail: 'No local or connected device is available for this agent.',
        message: 'No execution device for platform agent',
        operationId,
        topicId,
      });
      return {
        agentId: resolvedAgentId,
        assistantMessageId,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'No bound device',
        message: 'Platform agent requires a local or connected device',
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageId ?? parentMessageId ?? '',
      };
    }

    // Open the stream channel so the gateway WS subscription can receive
    // notify_update events published by agentNotify.notify.
    await persistOperationMetadata();
    const streamManager = createStreamEventManager();
    await streamManager
      .publishAgentRuntimeInit(operationId, {
        agentId: resolvedAgentId,
        assistantMessageId,
        heteroType,
        mirrorToOperationId: topicStartOwnerOperationId,
        topicId,
        userId: deps.userId,
      })
      .catch((err) => log('execAgent: failed to init stream for remote hetero: %O', err));

    // lh connect only handles tool_call_request (not agent_run_request),
    // so we use executeToolCall with the runHeteroTask tool instead of dispatchAgentRun.
    const result = await deviceGateway.executeToolCall(
      {
        deviceId: remoteDeviceId,
        userId: remoteDeviceUserId,
        workspaceId: remoteDeviceWorkspaceId,
      },
      {
        apiName: 'runHeteroTask',
        arguments: JSON.stringify({
          agentId: resolvedAgentId,
          agentType: heteroType,
          cwd: undefined,
          operationId,
          parentOperationId: topicStartOwnerOperationId,
          platformAgentId: agentConfig.agencyConfig?.heterogeneousProvider?.platformAgentId,
          prompt,
          taskId: operationId,
          topicId,
          // Scope notify callbacks to the same workspace as the dispatched
          // topic so agentNotify can resolve the workspace-owned topic.
          // Without this the device's notify call falls back to personal
          // mode and TopicModel.findById returns NOT_FOUND.
          workspaceId: deps.workspaceId,
        }),
        identifier: 'runHeteroTask',
      },
      120_000, // hetero tasks can take longer than the default 30 s
    );
    if (!result.success) {
      log('execAgent: remote hetero dispatch failed: %s', result.error);
      await finalizeHeteroDispatchError(deps, {
        agentId: resolvedAgentId,
        assistantMessageId,
        detail: result.error ?? 'Device dispatch failed',
        errorType: resolveHeteroDispatchErrorType(result.error),
        message: humanizeHeteroDispatchError(result.error),
        operationId,
        topicId,
      });
      return {
        agentId: resolvedAgentId,
        assistantMessageId,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: result.error,
        message: 'Remote hetero agent dispatch failed',
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageId ?? parentMessageId ?? '',
      };
    }
  } else {
    // Local CLI hetero (Amp / Claude Code / Codex / Kimi Code / OpenCode /
    // Pi / Qoder) — fork between device dispatch and cloud sandbox via the
    // shared execution plan:
    //   - requestedDeviceId (topic-level override) always wins
    //   - executionTarget 'device' → dispatch to boundDeviceId (errors if unset)
    //   - executionTarget 'local' + boundDeviceId (desktop sync opened on web)
    //     → dispatch to that device
    //   - everything else ('sandbox' / unbound 'local' / 'none' / unset) → cloud
    //     sandbox when the provider supports it; Amp and OpenCode remain
    //     unrouted because they require a local or connected device
    // `onlineDeviceIds` is intentionally omitted: hetero dispatch trusts
    // the binding and fails loudly at the gateway if the device is offline.
    // `canUseDevice` degrades device-capable targets to the sandbox when
    // available, or leaves device-only providers unrouted, for denied
    // senders (e.g. external bot users). Without this a synced local/device
    // binding would let them run on the owner's machine.

    // Register the op with the agent-gateway DO before dispatch, mirroring
    // the remote-hetero branch above. Local CLI hetero (claude-code / codex)
    // streams back via heteroIngest, which forwards live events the DO can
    // relay even without an init — so the FIRST run renders fine. But a later
    // `reconnectToGatewayOperation` (task topic drawer open / page reload)
    // sends a `resume` that asks the DO for the op's status; with no session
    // record the DO answers terminal, the client fires `session_complete`,
    // and `onSessionComplete` clears `topic.metadata.runningOperation`. The
    // still-running CC's next heteroIngest batch then hits
    // StaleHeteroOperationError and is silently dropped — the agent appears
    // to stop the moment the window is opened. Seeding the init keeps the DO
    // reporting `running`, so resume stays connected and keeps streaming.
    // Best-effort: a stream-manager/Redis failure must never block dispatch —
    // the init only powers reconnect, not the run. `createStreamEventManager`
    // probes Redis synchronously, so guard construction too, not just publish.
    try {
      await persistOperationMetadata();
      await createStreamEventManager().publishAgentRuntimeInit(operationId, {
        agentId: resolvedAgentId,
        assistantMessageId,
        heteroType,
        mirrorToOperationId: topicStartOwnerOperationId,
        topicId,
        userId: deps.userId,
      });
    } catch (err) {
      log('execAgent: failed to init stream for local hetero: %O', err);
    }

    const heteroPlan = resolveExecutionPlan({
      agencyConfig: agentConfig.agencyConfig,
      canUseDevice,
      isHetero: true,
      clientExecutionAvailable: false,
      requestedDeviceId,
      sandboxExecutionAvailable: supportsCloudHeterogeneousSandbox(heteroType),
      trigger: requestTrigger,
    });

    if (heteroPlan.kind !== 'sandbox') {
      const dispatchDeviceId = heteroPlan.kind === 'device' ? heteroPlan.deviceId : undefined;
      if (!dispatchDeviceId) {
        log('execAgent: hetero executionTarget=device but no boundDeviceId set');
        await finalizeHeteroDispatchError(deps, {
          agentId: resolvedAgentId,
          assistantMessageId,
          detail: !supportsCloudHeterogeneousSandbox(heteroType)
            ? 'No device bound. Pick a local or connected device in the Execution Device switcher.'
            : 'No device bound. Pick a device in the Execution Device switcher, or switch to Cloud sandbox.',
          message: 'No bound device for hetero agent',
          operationId,
          topicId,
        });
        return {
          agentId: resolvedAgentId,
          assistantMessageId,
          autoStarted: false,
          createdAt: new Date().toISOString(),
          error: 'No bound device',
          message: 'Hetero agent requires a bound device',
          operationId,
          status: 'error',
          success: false,
          timestamp: new Date().toISOString(),
          topicId,
          userMessageId: userMessageId ?? parentMessageId ?? '',
        };
      }
      // Resolve the working directory for the run: a topic-level override
      // wins, else the device's user-configured defaultCwd. The device row
      // lives in the DB (the gateway only knows live connections), so read
      // it directly rather than via deviceGateway.
      // The bound device may be personal (userId-scoped) or a workspace
      // device (workspace-scoped) — look up both so its defaultCwd resolves.
      const deviceModelForCwd = new DeviceModel(deps.db, deps.userId, deps.workspaceId);
      const boundDevice =
        (await deviceModelForCwd.findByDeviceId(dispatchDeviceId)) ??
        (await deviceModelForCwd.findWorkspaceDeviceById(dispatchDeviceId));
      const dispatchWorkspaceId = await deps.resolveDeviceWorkspaceId(dispatchDeviceId);
      // Resolve via the shared precedence helper so dispatch, workspace-init,
      // and the new-topic backfill below all agree on the cwd.
      const deviceCwdConfig = resolveDeviceWorkingDirectoryConfig({
        deviceDefaultCwd: boundDevice?.defaultCwd,
        deviceId: dispatchDeviceId,
        initialWorkingDirectory: appContext?.initialTopicMetadata?.workingDirectory,
        initialWorkingDirectoryConfig: appContext?.initialTopicMetadata?.workingDirectoryConfig,
        topicWorkingDirectory: topic?.metadata?.workingDirectory,
        topicWorkingDirectoryConfig: topic?.metadata?.workingDirectoryConfig,
        workingDirByDevice: agentConfig.agencyConfig?.workingDirByDevice,
      });
      const deviceCwd = getWorkingDirEffectivePath(deviceCwdConfig);

      // An unbound topic has no pinned cwd yet: the directory was only
      // recorded at agent level (`workingDirByDevice`) when no topic existed.
      // Persist the resolved cwd onto the topic so the sidebar groups it
      // under the right project and the next turn reuses the same directory.
      await deps.bindTopicWorkingDirectory({
        config: deviceCwdConfig,
        currentWorkingDirectory: topic?.metadata?.workingDirectory,
        topicId,
      });

      // Build only device-relevant context instead of reusing the cloud-sandbox one
      // (which describes an ephemeral /workspace + pre-cloned repos and would mislead
      // the agent). The spawned CLI already receives deviceCwd as its actual cwd.
      const deviceSystemContext = buildRemoteDeviceHeteroContext({
        agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
        conversationHistory: resumeSessionId ? undefined : conversationHistory,
      });
      const deviceResumeFallbackSystemContext =
        resumeSessionId && conversationHistory
          ? buildRemoteDeviceHeteroContext({
              agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
              conversationHistory,
            })
          : undefined;

      const result = await deviceGateway.dispatchAgentRun({
        ...heteroParams,
        args: heteroExecArgs,
        cwd: deviceCwd,
        deviceId: dispatchDeviceId,
        resumeFallbackSystemContext: deviceResumeFallbackSystemContext,
        systemContext: deviceSystemContext,
        // Route to the workspace pool when this is a workspace device; the
        // operation JWT stays member-scoped (the run belongs to the member).
        workspaceId: dispatchWorkspaceId,
        // Topic scope for device-side heteroIngest/heteroFinish. Distinct
        // from the routing workspace above: a workspace topic on a personal
        // device still has to write back under `deps.workspaceId`.
        ingestWorkspaceId: deps.workspaceId,
      });
      if (!result.success) {
        log('execAgent: hetero device dispatch failed: %s', result.error);
        await finalizeHeteroDispatchError(deps, {
          agentId: resolvedAgentId,
          assistantMessageId,
          detail: result.error ?? 'Device dispatch failed',
          errorType: resolveHeteroDispatchErrorType(result.error),
          message: humanizeHeteroDispatchError(result.error),
          operationId,
          topicId,
        });
        return {
          agentId: resolvedAgentId,
          assistantMessageId,
          autoStarted: false,
          createdAt: new Date().toISOString(),
          error: result.error,
          message: 'Hetero agent device dispatch failed',
          operationId,
          status: 'error',
          success: false,
          timestamp: new Date().toISOString(),
          topicId,
          userMessageId: userMessageId ?? parentMessageId ?? '',
        };
      }
    } else {
      if (!supportsCloudHeterogeneousSandbox(heteroType)) {
        const message = `${getHeterogeneousAgentTitle(heteroType)} requires a local or connected device; cloud sandbox execution is not supported.`;
        await finalizeHeteroDispatchError(deps, {
          agentId: resolvedAgentId,
          assistantMessageId,
          detail: message,
          message,
          operationId,
          topicId,
        });
        return {
          agentId: resolvedAgentId,
          assistantMessageId,
          autoStarted: false,
          createdAt: new Date().toISOString(),
          error: message,
          message,
          operationId,
          status: 'error',
          success: false,
          timestamp: new Date().toISOString(),
          topicId,
          userMessageId: userMessageId ?? parentMessageId ?? '',
        };
      }

      // Cloud sandbox path — only for sandbox-provisioned local CLI agents.
      // Remote agents (openclaw / hermes) always require a bound device.
      // Lazy-loaded on purpose: `sandboxRunner` pulls the sandbox-service graph
      // (which eagerly touches server-only ModelRuntime env at module init), so
      // importing it statically would couple that whole subsystem into every
      // `aiAgent` import. Only this cloud-CLI branch needs it.
      const { spawnHeteroSandbox } =
        await import('@/server/services/heterogeneousAgent/sandboxRunner');
      const marketService = await deps.getMarketService();
      // The sandbox authenticates its nested `lh` calls with this JWT. The
      // narrow `hetero-operation` token (used for the device-dispatch path
      // above) is rejected by `oidcAuth`, so CC capabilities that hit
      // user-scoped endpoints — e.g. uploading a `Read`-on-image result to
      // the file store for thumbnail echo — would 401 and silently drop.
      // Mint a user-scoped `cli-sandbox` token instead (still `sub: userId`,
      // ownership-gated on heteroIngest/heteroFinish) with a run-length TTL
      // so it outlives a multi-hour run.
      const sandboxJwt = await signUserJWT(deps.userId, '4h');
      spawnHeteroSandbox({
        ...heteroParams,
        agentType: heteroType as 'claude-code' | 'codex',
        args: heteroExecArgs,
        jwt: sandboxJwt,
        marketService,
        workspaceId: deps.workspaceId,
      }).catch(async (err) => {
        // Fire-and-forget: execAgent has already returned `autoStarted`, and
        // the sandbox never reached the point of calling heteroFinish. Drive
        // the same terminal funnel so the stranded run surfaces an error and
        // its task is marked failed instead of hanging in `running`.
        log('execAgent: hetero sandbox spawn failed: %O', err);
        await finalizeHeteroDispatchError(deps, {
          agentId: resolvedAgentId,
          assistantMessageId,
          detail: err instanceof Error ? err.message : String(err),
          message: 'Hetero sandbox spawn failed',
          operationId,
          topicId,
        }).catch((finalizeErr) =>
          log('execAgent: sandbox-failure finalize failed: %O', finalizeErr),
        );
      });
    }
  }

  let gatewayToken: string | undefined;
  if (!deps.withholdGatewayToken) {
    try {
      gatewayToken = await signUserJWT(deps.userId);
    } catch {
      // non-critical
    }
  }

  return {
    agentId: resolvedAgentId,
    assistantMessageId,
    autoStarted: true,
    createdAt: new Date().toISOString(),
    heteroType,
    message: 'Hetero agent dispatched successfully',
    operationId,
    status: 'created',
    success: true,
    timestamp: new Date().toISOString(),
    token: gatewayToken,
    topicId,
    userMessageId: userMessageId ?? parentMessageId ?? '',
  };
};
