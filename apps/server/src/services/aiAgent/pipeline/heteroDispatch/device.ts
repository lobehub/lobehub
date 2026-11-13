import { claudeCodeAgentEnvPicksLogin } from '@lobechat/heterogeneous-agents/quota';
import type { ExecAgentResult } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DeviceModel } from '@/database/models/device';
import type { ExecutionPlan } from '@/helpers/executionTarget';
import { AgentQuotaService } from '@/server/services/agentQuota';
import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';
import {
  type ManagedDeviceTarget,
  waitForManagedDeviceOnline,
  wakeManagedDevice,
} from '@/server/services/deviceGateway/managedDeviceWake';
import { buildRemoteDeviceHeteroContext } from '@/server/services/heterogeneousAgent/remoteDeviceHeteroContext';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import {
  humanizeHeteroDispatchError,
  isDeviceResponseTimeout,
  resolveHeteroDispatchErrorType,
  supportsCloudHeterogeneousSandbox,
} from '../../helpers/heteroErrors';
import { resolveDeviceWorkingDirectoryConfig } from '../../resolveDeviceWorkingDirectory';
import type { ExecRunContext } from '../../types';
import { selectCodexDeviceDispatch } from '../codexDeviceRuntime';
import { traceHeteroStage } from '../sendTracing';
import type { PreparedHeteroRun } from './prepare';
import { scheduleTimedOutDispatchConfirmation } from './timeoutConfirmation';
import type { HeteroDispatchDeps, HeteroDispatchInput, HeteroRun } from './types';
import { failHeteroDispatch, settleInOrder } from './utils';

const log = debug('lobe-server:ai-agent-service');

/** A plan `dispatchToCliDevice` can act on: a waking device is woken first. */
type CliDispatchPlan = Exclude<ExecutionPlan, { kind: 'device-wakeable' }>;

type CliDispatchParams = Parameters<typeof dispatchToCliDevice>[2];

/**
 * The Claude Code account the agent's Manage-accounts choice routes this run
 * to. The device maps it to one of its own logins: without it the device
 * always spawned on its default login, whatever account the user picked.
 * An agent whose env picks its own login, or the quota service failing, means
 * no routing — the run must not be blocked by account bookkeeping.
 */
const resolveClaudeAccountRouting = async (
  deps: HeteroDispatchDeps,
  params: {
    agentId: string;
    /** Gateway id of the device the run is dispatched to. */
    deviceId: string;
    heteroType: HeteroDispatchInput['heteroType'];
    heterogeneousProvider: HeteroDispatchInput['heterogeneousProvider'];
  },
) => {
  if (params.heteroType !== 'claude-code') return;
  if (claudeCodeAgentEnvPicksLogin(params.heterogeneousProvider?.env)) return;

  try {
    const quota = new AgentQuotaService(deps.db, deps.userId, deps.workspaceId);
    // The device's own account choice wins; an agent-wide pin made on another
    // machine must not block this one.
    const routing = await quota.planDeviceRouting(params.agentId, {
      deviceId: await quota.resolveDeviceRowId(params.deviceId),
      provider: 'claude-code',
    });
    return routing ?? undefined;
  } catch (err) {
    log('execAgent: Claude Code account routing failed: %O', err);
    return;
  }
};

/**
 * Dispatch a local CLI hetero agent to the device its execution plan routed it
 * to: pick the Codex runtime, resolve and bind the working directory, build the
 * device-only system context, dispatch, and record the device route so a stop
 * request reaches the process.
 *
 * Returns the terminal error result when the run cannot start, `undefined`
 * once the device accepted it — or may have, when only its ack timed out.
 */
export const dispatchToCliDevice = async (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  params: {
    agentConfig: ExecRunContext['agentConfig'];
    appContext: ExecRunContext['appContext'];
    cliDeviceWorkspaceId?: string;
    heteroPlan: CliDispatchPlan;
    heteroType: HeteroDispatchInput['heteroType'];
    heterogeneousProvider: HeteroDispatchInput['heterogeneousProvider'];
    /**
     * For a dispatch that runs after the response, when a Stop can land while
     * it prepares: checked right before the gateway hop (a stopped run is not
     * sent) and right after it (a run stopped mid-hop is cancelled on the
     * device). The synchronous send leaves it out: the client cannot stop a
     * run it has not been told about yet.
     */
    isStopped?: () => Promise<boolean>;
    prepared: PreparedHeteroRun;
  },
): Promise<ExecAgentResult | undefined> => {
  const {
    agentConfig,
    appContext,
    cliDeviceWorkspaceId,
    heteroPlan,
    heteroType,
    heterogeneousProvider,
    isStopped,
    prepared,
  } = params;
  const {
    agentSystemContext,
    conversationHistory,
    heteroExecArgs,
    heteroParams,
    resumeSessionId,
    topic,
    topicRepos,
    unansweredUserTurns,
  } = prepared;
  const { agentId: resolvedAgentId, operationId, topicId } = run;

  const dispatchDeviceId = heteroPlan.kind === 'device' ? heteroPlan.deviceId : undefined;
  if (!dispatchDeviceId) {
    log('execAgent: hetero executionTarget=device but no boundDeviceId set');
    return failHeteroDispatch(
      deps,
      run,
      {
        detail: !supportsCloudHeterogeneousSandbox(heteroType)
          ? 'No device bound. Pick a local or connected device in the Execution Device switcher.'
          : 'No device bound. Pick a device in the Execution Device switcher, or switch to Cloud sandbox.',
        message: 'No bound device for hetero agent',
      },
      { error: 'No bound device', message: 'Hetero agent requires a bound device' },
    );
  }
  // The Codex runtime, the device row and the Claude Code account are three
  // independent reads keyed only by the device, so they run together. All of
  // them are reads: a rejected Codex runtime below still leaves nothing written.
  // The device row lives in the DB (the gateway only knows live connections),
  // so read it directly rather than via deviceGateway. The bound device may be
  // personal (userId-scoped) or a workspace device (workspace-scoped) — look
  // up both so its defaultCwd resolves.
  const deviceModelForCwd = new DeviceModel(deps.db, deps.userId, deps.workspaceId);
  const [codexRuntime, boundDevice, claudeAccountRouting] = await settleInOrder([
    traceHeteroStage('device codex_runtime', () =>
      selectCodexDeviceDispatch({
        db: deps.db,
        heterogeneousProvider,
        heteroType,
        readSystemInfo: (clientKinds) =>
          deviceGateway.readDeviceSystemInfo(deps.userId, dispatchDeviceId, cliDeviceWorkspaceId, {
            clientKinds,
          }),
        resume: Boolean(resumeSessionId),
        userId: deps.userId,
      }),
    ),
    traceHeteroStage(
      'device bound_device',
      async () =>
        (await deviceModelForCwd.findByDeviceId(dispatchDeviceId)) ??
        (await deviceModelForCwd.findWorkspaceDeviceById(dispatchDeviceId)),
    ),
    traceHeteroStage('device account_routing', () =>
      resolveClaudeAccountRouting(deps, {
        agentId: resolvedAgentId,
        deviceId: dispatchDeviceId,
        heteroType,
        heterogeneousProvider,
      }),
    ),
  ]);
  if (codexRuntime.kind === 'error') {
    return failHeteroDispatch(
      deps,
      run,
      { detail: codexRuntime.message, message: 'Native Codex dispatch rejected' },
      { error: codexRuntime.message, message: codexRuntime.message },
    );
  }
  const nativeCodex = codexRuntime.kind === 'native' ? codexRuntime : undefined;

  // Resolve the working directory for the run: a topic-level override
  // wins, else the device's user-configured defaultCwd.
  const dispatchWorkspaceId = cliDeviceWorkspaceId;
  // Resolve via the shared precedence helper so dispatch, workspace-init,
  // and the new-topic backfill below all agree on the cwd.
  const deviceCwdConfig = resolveDeviceWorkingDirectoryConfig({
    deviceDefaultCwd: boundDevice?.defaultCwd,
    deviceId: dispatchDeviceId,
    devicePlatform: boundDevice?.platform,
    initialWorkingDirectory: appContext?.initialTopicMetadata?.workingDirectory,
    initialWorkingDirectoryConfig: appContext?.initialTopicMetadata?.workingDirectoryConfig,
    // The run's repos, so a directory that IS one of them is skipped: this
    // device cannot have it (`owner/repo` is a cloud repo identifier).
    repos: topicRepos,
    topicDeviceId: topic?.metadata?.boundDeviceId,
    topicWorkingDirectory: topic?.metadata?.workingDirectory,
    topicWorkingDirectoryConfig: topic?.metadata?.workingDirectoryConfig,
    workingDirByDevice: agentConfig.agencyConfig?.workingDirByDevice,
  });
  // Local CLIs (Claude Code, Codex) key their sessions by cwd, so the spawn cwd
  // stays on the SOURCE repo, mirroring the client's `conversationLifecycle`.
  // The active worktree is a record the agent may already have deleted:
  // spawning in it would lose the session, or fail the run outright once the
  // directory is gone. The agent is told about it in the system context instead.
  const deviceCwd = getWorkingDirSourcePath(deviceCwdConfig);
  const worktreePath = deviceCwdConfig?.git?.activeWorktree;
  const worktreeContext = worktreePath
    ? { activeWorktree: { path: worktreePath, sourceDirectory: deviceCwd } }
    : {};

  // An unbound topic has no pinned cwd yet: the directory was only
  // recorded at agent level (`workingDirByDevice`) when no topic existed.
  // Persist the resolved cwd onto the topic so the sidebar groups it
  // under the right project and the next turn reuses the same directory.
  //
  // The registry recheck is a read the topic write cannot change, so it runs
  // alongside it and still lands right before the dispatch. It fails closed:
  // a missing device refuses the dispatch, and a failed read throws before it.
  const [, authorizationError] = await settleInOrder([
    traceHeteroStage('device bind_working_directory', () =>
      deps.bindTopicWorkingDirectory({
        config: deviceCwdConfig,
        currentDeviceId: topic?.metadata?.boundDeviceId,
        currentWorkingDirectory: topic?.metadata?.workingDirectory,
        deviceId: dispatchDeviceId,
        topicId,
      }),
    ),
    traceHeteroStage('device authorization', () =>
      resolveDeviceDispatchAuthorizationFailure(
        deps.db,
        deps.userId,
        dispatchDeviceId,
        dispatchWorkspaceId,
      ),
    ),
  ]);

  // Build only device-relevant context instead of reusing the cloud-sandbox one
  // (which describes an ephemeral /workspace + pre-cloned repos and would mislead
  // the agent). The spawned CLI already receives deviceCwd as its actual cwd.
  const deviceSystemContext = buildRemoteDeviceHeteroContext({
    ...worktreeContext,
    agentSystemContext,
    conversationHistory: resumeSessionId ? undefined : conversationHistory,
    unansweredUserTurns,
  });
  const deviceResumeFallbackSystemContext =
    resumeSessionId && conversationHistory
      ? buildRemoteDeviceHeteroContext({
          ...worktreeContext,
          agentSystemContext,
          conversationHistory,
        })
      : undefined;

  // A Stop that settled the run while it prepared found no process to cancel;
  // sending it now would start a CLI nobody can see. The stop path already
  // settled the operation and its marker, so there is nothing left to write.
  if (!authorizationError && (await isStopped?.())) {
    log('execAgent: op=%s stopped while its dispatch prepared, not dispatching', operationId);
    return undefined;
  }

  // Anything that touches the run after this instant proves it started.
  const dispatchedAt = new Date();
  const result = authorizationError
    ? { error: 'DEVICE_NOT_FOUND', errorData: authorizationError, success: false }
    : await traceHeteroStage('device gateway_dispatch', () =>
        deviceGateway.dispatchAgentRun({
          ...heteroParams,
          agentId: resolvedAgentId,
          // Only a live client advertising the native protocol receives these wrapper flags.
          args: nativeCodex ? [...(heteroExecArgs ?? []), ...nativeCodex.args] : heteroExecArgs,
          ...(claudeAccountRouting && { claudeAccountRouting }),
          clientKinds: nativeCodex?.clientKinds,
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
        }),
      );
  if (!result.success) {
    const finalize = {
      detail: result.error ?? 'Device dispatch failed',
      deviceRoute: {
        deviceId: dispatchDeviceId,
        userId: deps.userId,
        ...(dispatchWorkspaceId ? { workspaceId: dispatchWorkspaceId } : {}),
      },
      errorData: result.errorData,
      errorType: resolveHeteroDispatchErrorType(result.error),
      message: humanizeHeteroDispatchError(result.error),
    };
    const failure = {
      error: result.error,
      errorData: result.errorData,
      message: 'Hetero agent device dispatch failed',
    };

    // A lost ack is not proof the run never started — the device may already
    // be spawning it. Keep the run alive and fail it only if nothing shows up.
    if (!isDeviceResponseTimeout(result.error)) {
      log('execAgent: hetero device dispatch failed: %s', result.error);
      return failHeteroDispatch(deps, run, finalize, failure);
    }

    log('execAgent: hetero device dispatch unconfirmed, awaiting first ingest op=%s', operationId);
    scheduleTimedOutDispatchConfirmation(deps, run, { dispatchedAt, finalize, result: failure });
  }

  // A Stop that landed during the gateway hop may have found no process yet.
  // The device registers the process before it acks, so cancel it now; the
  // stop path already settled the operation, so the route is not recorded.
  if (result.success && (await isStopped?.())) {
    log('execAgent: op=%s stopped during its dispatch, cancelling on the device', operationId);
    await traceHeteroStage('device cancel_stopped_dispatch', () =>
      deviceGateway.executeToolCall(
        { deviceId: dispatchDeviceId, userId: deps.userId, workspaceId: dispatchWorkspaceId },
        {
          apiName: 'cancelHeteroTask',
          arguments: JSON.stringify({ signal: 'SIGINT', taskId: operationId }),
          identifier: 'cancelHeteroTask',
        },
        10_000,
      ),
    ).catch((err) => log('execAgent: cancelling a stopped dispatch failed: %O', err));
    return undefined;
  }

  // Local CLI hetero agents dispatch to a device just like remote platform
  // agents, so persist the device route once the dispatch is accepted (or may
  // have been, after a timeout).
  // interruptTask uses these fields to find and stop the native process.
  try {
    const patched = await traceHeteroStage('device patch_running_operation', () =>
      deps.topicModel.patchRunningOperation(topicId, operationId, {
        deviceId: dispatchDeviceId,
        deviceWorkspaceId: dispatchWorkspaceId,
        heteroType,
      }),
    );
    log(
      'execAgent: patch runningOperation device info=%s deviceId=%s heteroType=%s op=%s',
      patched,
      dispatchDeviceId,
      heteroType,
      operationId,
    );
  } catch (err) {
    log('execAgent: failed to patch runningOperation with device info: %O', err);
  }

  return undefined;
};

/** Whether the run settled (stopped, failed) before a dispatch run after the response. */
const isRunStopped = async (deps: HeteroDispatchDeps, run: HeteroRun) =>
  !(await new AgentOperationModel(deps.db, deps.userId, deps.workspaceId).isRunningOnTopic(
    run.operationId,
    run.topicId,
  ));

/** Off the request path nothing else would settle the run, so a throw is its error. */
const failDispatchAfterResponse = async (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  deviceId: string,
  error: unknown,
  label: string,
) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[HeteroDispatch] ${label}`, {
    deviceId,
    error: message,
    operationId: run.operationId,
  });
  await failHeteroDispatch(
    deps,
    run,
    { detail: message, message: 'Hetero agent device dispatch failed' },
    { error: message, message: 'Hetero agent device dispatch failed' },
  );
};

/**
 * Dispatch to an online device after the response (`agent_deferred_hetero_dispatch`).
 *
 * The run is already durable and its marker names the device, so the client can
 * stop it and render it as soon as `execAgent` returns; only the device steps
 * (Codex runtime, working directory, account routing, the registry recheck and
 * the gateway hop) move off the send. A refused dispatch settles through
 * `failHeteroDispatch` exactly like an immediate one: the error lands on the
 * assistant message and the run's stream closes. A run stopped before the
 * gateway hop is not dispatched, and one stopped during it is cancelled on
 * the device (see `isStopped` on `dispatchToCliDevice`).
 */
export const deferCliDeviceDispatch = (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  params: CliDispatchParams & { heteroPlan: Extract<CliDispatchPlan, { kind: 'device' }> },
): void => {
  const { deviceId } = params.heteroPlan;
  afterUnscoped(() =>
    traceHeteroStage('deferred_device_dispatch', async () => {
      try {
        if (await isRunStopped(deps, run)) {
          log('execAgent: op=%s settled before its deferred dispatch, skipping', run.operationId);
          return;
        }
        await dispatchToCliDevice(deps, run, {
          ...params,
          isStopped: () => isRunStopped(deps, run),
        });
      } catch (error) {
        await failDispatchAfterResponse(
          deps,
          run,
          deviceId,
          error,
          'Deferred device dispatch failed',
        );
      }
    }),
  );
};

/**
 * Wake a managed cloud device, then dispatch to it once it is online.
 *
 * The wake request is sent before the response. The wait (see
 * `waitForManagedDeviceOnline`) and the dispatch run after the response, like
 * the timed-out dispatch confirmation. If the device does not come online in
 * time, the dispatch still runs. The gateway refuses it as offline, and the
 * existing offline handling (the device error on the run, the goal's device
 * wait) takes over. A run stopped during the wait is not dispatched.
 *
 * If the provider refuses the wake, the device will not come online. The run
 * then dispatches at once, with no wait, and the offline handling takes over
 * as for any offline device.
 *
 * Returns `undefined` after an accepted wake: the run counts as started. A
 * later failure settles it through the same path as an immediate dispatch
 * failure.
 */
export const dispatchToWakingCliDevice = async (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  params: Omit<CliDispatchParams, 'heteroPlan'> & {
    device: ManagedDeviceTarget;
    heteroPlan: Extract<ExecutionPlan, { kind: 'device-wakeable' }>;
  },
): Promise<ExecAgentResult | undefined> => {
  const { device, heteroPlan, ...dispatchParams } = params;

  const devicePlan = {
    deviceId: heteroPlan.deviceId,
    kind: 'device' as const,
    target: heteroPlan.target,
  };

  if (!(await traceHeteroStage('wake_device', () => wakeManagedDevice(deps.userId, device)))) {
    log(
      'execAgent: wake refused for managed device %s, dispatching op=%s now',
      heteroPlan.deviceId,
      run.operationId,
    );
    return dispatchToCliDevice(deps, run, { ...dispatchParams, heteroPlan: devicePlan });
  }

  const isStopped = () => isRunStopped(deps, run);

  const dispatchWhenOnline = async () => {
    try {
      const online = await waitForManagedDeviceOnline(deps.userId, device, {
        shouldStop: isStopped,
      });
      if (await isStopped()) {
        log(
          'execAgent: op=%s settled while its managed device woke, not dispatching',
          run.operationId,
        );
        return;
      }
      log(
        'execAgent: managed device %s online=%s, dispatching op=%s',
        heteroPlan.deviceId,
        online,
        run.operationId,
      );
      await dispatchToCliDevice(deps, run, {
        ...dispatchParams,
        heteroPlan: devicePlan,
        isStopped,
      });
    } catch (error) {
      await failDispatchAfterResponse(
        deps,
        run,
        heteroPlan.deviceId,
        error,
        'Dispatch to a woken managed device failed',
      );
    }
  };

  afterUnscoped(dispatchWhenOnline);
  return undefined;
};
