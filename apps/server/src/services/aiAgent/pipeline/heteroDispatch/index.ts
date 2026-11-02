import {
  HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import type { ExecAgentResult } from '@lobechat/types';
import { resolveHeterogeneousRuntimeConfig } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { resolveExecutionPlan, resolveWorkspaceScoped } from '@/helpers/executionTarget';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import {
  createAgentStateManager,
  createStreamEventManager,
} from '@/server/modules/AgentRuntime/factory';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';

import { supportsCloudHeterogeneousSandbox } from '../../helpers/heteroErrors';
import type { ExecRunContext } from '../../types';
import { dispatchToCliDevice } from './device';
import { prepareHeteroRun } from './prepare';
import { dispatchToPlatformDevice } from './remote';
import { spawnInCloudSandbox } from './sandbox';
import type { HeteroDispatchDeps, HeteroDispatchInput, HeteroRun } from './types';
import { failHeteroDispatch, heteroErrorResult } from './utils';

export type { HeteroDispatchDeps, HeteroDispatchInput } from './types';

const log = debug('lobe-server:ai-agent-service');

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
    topicStartOwnerOperationId,
  } = input;

  const isRemoteHetero = isRemoteHeterogeneousType(heteroType);
  // Same structured shape as the built-in path (`op_{ts}_{agentId}_{topicId}_{rand}`)
  // so hetero ops aren't visually distinct bare nanoids in the trace/op tables.
  const operationId =
    input.reservedOperationId ?? `op_${Date.now()}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

  // Retain only public configuration dimensions. CLI args and API credentials must
  // never be copied into topic metadata or an inspector response. The receipt
  // reads the same provider and pin as the dispatched CLI args below.
  const runtimeConfig = {
    fields: resolveHeterogeneousRuntimeConfig(
      heterogeneousProvider ?? { type: heteroType },
      pinnedHeterogeneousTopicModel,
      input.pinnedHeterogeneousTopicSources ?? 'topic',
    ),
    operationId,
  };

  // Hooks belong to this operation's lifecycle. Persist their serializable
  // form on the durable operation row before dispatch; runningOperation below
  // remains a compatibility mirror for older terminal consumers.
  hookDispatcher.register(operationId, hooks ?? []);
  const serializedHooks = hookDispatcher.getSerializedHooks(operationId);

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
    requireReservation: !!input.reservedOperationId,
    agentId: persistAgentId,
    appContext: { ...appContext, sourceMessageId: userMessageId },
    chatGroupId: appContext?.groupId ?? null,
    maxSteps,
    metadata: {
      _hooks: serializedHooks,
      assistantMessageId,
      heterogeneousRuntimeConfig: runtimeConfig,
    },
    operationId,
    parentOperationId,
    provider: heteroType,
    taskId: operationTaskId ?? null,
    threadId: appContext?.threadId ?? null,
    topicId,
    trigger,
  });
  if (!operationPersisted) {
    hookDispatcher.unregister(operationId);
    throw new Error('Failed to persist heterogeneous agent operation');
  }

  await input.onOperationCreated?.(operationId);

  const run: HeteroRun = {
    agentId: resolvedAgentId,
    assistantMessageId,
    operationId,
    topicId,
    userMessageId: userMessageId ?? parentMessageId ?? '',
  };

  // Resume session, operation JWT, topic repos, GitHub token, recovery
  // history, sandbox placement, system contexts and the CLI request.
  const prepared = await prepareHeteroRun(deps, ctx, input, operationId);

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

  // Resolve CLI-device routing before persisting the marker. Cancellation
  // must address the same device even though local CLI agents use a different
  // dispatch transport from notify-based platform agents.
  const cliPlanParams = {
    agencyConfig: agentConfig.agencyConfig,
    clientExecutionAvailable: false,
    isHetero: true,
    requestedDeviceId,
    sandboxExecutionAvailable: supportsCloudHeterogeneousSandbox(heteroType),
    trigger: requestTrigger,
  };
  const deviceHeteroPlan = !isRemoteHetero
    ? resolveExecutionPlan({ ...cliPlanParams, canUseDevice })
    : undefined;
  const cliDeviceId = deviceHeteroPlan?.kind === 'device' ? deviceHeteroPlan.deviceId : undefined;
  // Whether the sandbox is a fallback for a sender denied the agent's device:
  // with access the same request would have routed to a device. Lets a failed
  // sandbox run tell the sender why it ran there instead.
  const deviceAccessDenied =
    deviceHeteroPlan?.kind === 'sandbox' &&
    !canUseDevice &&
    resolveExecutionPlan({ ...cliPlanParams, canUseDevice: true }).kind === 'device';
  const cliDeviceWorkspaceId = cliDeviceId
    ? await deps.resolveDeviceWorkspaceId(cliDeviceId)
    : undefined;

  // Register the run's lifecycle hooks so the hetero terminal path fires
  // onComplete/onError through the same `hookDispatcher` the normal LLM
  // runtime uses — driving the task lifecycle (onTopicComplete) and IM bot
  // completion callbacks uniformly. The hetero block returns before
  // AgentRuntimeService (which registers hooks for normal runs), so we do it
  // here. Local mode dispatches these in-memory handlers; queue mode delivers
  // the serialized webhooks persisted on the operation row above.
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
      : cliDeviceId
        ? {
            deviceId: cliDeviceId,
            deviceUserId: deps.userId,
            deviceWorkspaceId: cliDeviceWorkspaceId,
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
      // Same contract as `finalizeHeteroDispatchError`: read the hook before the
      // dispatch settles and unregisters it, so the caller learns whether this
      // failure was already announced to its own surfaces.
      const terminalReported = hookDispatcher.canDeliver(operationId, 'onComplete');
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
      return heteroErrorResult(run, { error: message, message, terminalReported });
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
    // The receipt previously had a separate projection write after this marker.
    // Store both together so a follow-up cannot install a new running operation
    // while retaining the previous operation's displayed configuration.
    // Task drawer follow-ups can omit taskId; receipt ownership is independent
    // of Task lifecycle association, while isolated children keep the root receipt.
    await deps.topicModel.updateMetadata(topicId, {
      heteroRuntimeConfig: runtimeConfig,
      runningOperation: childOperation,
    });
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
    return failHeteroDispatch(
      deps,
      run,
      {
        detail: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
        message: 'Provider-bound heterogeneous agents do not support this execution target',
      },
      {
        error: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
        message: 'Heterogeneous agent provider binding requires Desktop local execution',
      },
    );
  }

  if (isRemoteHetero) {
    const failure = await dispatchToPlatformDevice(deps, run, {
      agentConfig,
      canUseDevice,
      deviceAccessReason,
      heteroType,
      persistOperationMetadata,
      prompt,
      remoteDeviceId,
      remoteDeviceUserId,
      remoteDeviceWorkspaceId,
      topicStartOwnerOperationId,
    });
    if (failure) return failure;
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

    const heteroPlan = deviceHeteroPlan!;
    const failure =
      heteroPlan.kind !== 'sandbox'
        ? await dispatchToCliDevice(deps, run, {
            agentConfig,
            appContext,
            cliDeviceWorkspaceId,
            heteroPlan,
            heteroType,
            heterogeneousProvider,
            prepared,
          })
        : await spawnInCloudSandbox(deps, run, { deviceAccessDenied, heteroType, prepared });
    if (failure) return failure;
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
