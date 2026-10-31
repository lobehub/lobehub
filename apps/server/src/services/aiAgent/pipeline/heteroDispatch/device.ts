import { claudeCodeAgentEnvPicksLogin } from '@lobechat/heterogeneous-agents/quota';
import type { ExecAgentResult } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import debug from 'debug';

import { DeviceModel } from '@/database/models/device';
import type { ExecutionPlan } from '@/helpers/executionTarget';
import { AgentQuotaService } from '@/server/services/agentQuota';
import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';
import { buildRemoteDeviceHeteroContext } from '@/server/services/heterogeneousAgent/remoteDeviceHeteroContext';

import {
  humanizeHeteroDispatchError,
  isDeviceResponseTimeout,
  resolveHeteroDispatchErrorType,
  supportsCloudHeterogeneousSandbox,
} from '../../helpers/heteroErrors';
import { resolveDeviceWorkingDirectoryConfig } from '../../resolveDeviceWorkingDirectory';
import type { ExecRunContext } from '../../types';
import { selectCodexDeviceDispatch } from '../codexDeviceRuntime';
import { buildCodexWorktreeWritableArgs } from './codexWorktreeArgs';
import type { PreparedHeteroRun } from './prepare';
import { scheduleTimedOutDispatchConfirmation } from './timeoutConfirmation';
import type { HeteroDispatchDeps, HeteroDispatchInput, HeteroRun } from './types';
import { failHeteroDispatch } from './utils';

const log = debug('lobe-server:ai-agent-service');

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
    heteroType: HeteroDispatchInput['heteroType'];
    heterogeneousProvider: HeteroDispatchInput['heterogeneousProvider'];
  },
) => {
  if (params.heteroType !== 'claude-code') return;
  if (claudeCodeAgentEnvPicksLogin(params.heterogeneousProvider?.env)) return;

  try {
    const routing = await new AgentQuotaService(
      deps.db,
      deps.userId,
      deps.workspaceId,
    ).planDeviceRouting(params.agentId, { provider: 'claude-code' });
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
    heteroPlan: ExecutionPlan;
    heteroType: HeteroDispatchInput['heteroType'];
    heterogeneousProvider: HeteroDispatchInput['heterogeneousProvider'];
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
  const codexRuntime = await selectCodexDeviceDispatch({
    db: deps.db,
    heterogeneousProvider,
    heteroType,
    readSystemInfo: (clientKinds) =>
      deviceGateway.readDeviceSystemInfo(deps.userId, dispatchDeviceId, cliDeviceWorkspaceId, {
        clientKinds,
      }),
    resume: Boolean(resumeSessionId),
    userId: deps.userId,
  });
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
  // wins, else the device's user-configured defaultCwd. The device row
  // lives in the DB (the gateway only knows live connections), so read
  // it directly rather than via deviceGateway.
  // The bound device may be personal (userId-scoped) or a workspace
  // device (workspace-scoped) — look up both so its defaultCwd resolves.
  const deviceModelForCwd = new DeviceModel(deps.db, deps.userId, deps.workspaceId);
  const boundDevice =
    (await deviceModelForCwd.findByDeviceId(dispatchDeviceId)) ??
    (await deviceModelForCwd.findWorkspaceDeviceById(dispatchDeviceId));
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
  const worktreeArgs =
    heteroType === 'codex'
      ? buildCodexWorktreeWritableArgs({
          providerArgs:
            heterogeneousProvider?.type === heteroType ? heterogeneousProvider.args : undefined,
          sourceDirectory: deviceCwd,
          worktreePath,
        })
      : [];
  const deviceArgs =
    worktreeArgs.length > 0 ? [...(heteroExecArgs ?? []), ...worktreeArgs] : heteroExecArgs;

  // An unbound topic has no pinned cwd yet: the directory was only
  // recorded at agent level (`workingDirByDevice`) when no topic existed.
  // Persist the resolved cwd onto the topic so the sidebar groups it
  // under the right project and the next turn reuses the same directory.
  await deps.bindTopicWorkingDirectory({
    config: deviceCwdConfig,
    currentDeviceId: topic?.metadata?.boundDeviceId,
    currentWorkingDirectory: topic?.metadata?.workingDirectory,
    deviceId: dispatchDeviceId,
    topicId,
  });

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

  const claudeAccountRouting = await resolveClaudeAccountRouting(deps, {
    agentId: resolvedAgentId,
    heteroType,
    heterogeneousProvider,
  });

  const authorizationError = await resolveDeviceDispatchAuthorizationFailure(
    deps.db,
    deps.userId,
    dispatchDeviceId,
    dispatchWorkspaceId,
  );
  // Anything that touches the run after this instant proves it started.
  const dispatchedAt = new Date();
  const result = authorizationError
    ? { error: 'DEVICE_NOT_FOUND', errorData: authorizationError, success: false }
    : await deviceGateway.dispatchAgentRun({
        ...heteroParams,
        agentId: resolvedAgentId,
        // Only a live client advertising the native protocol receives these wrapper flags.
        args: nativeCodex ? [...(deviceArgs ?? []), ...nativeCodex.args] : deviceArgs,
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
      });
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

  // Local CLI hetero agents dispatch to a device just like remote platform
  // agents, so persist the device route once the dispatch is accepted (or may
  // have been, after a timeout).
  // interruptTask uses these fields to find and stop the native process.
  try {
    const patched = await deps.topicModel.patchRunningOperation(topicId, operationId, {
      deviceId: dispatchDeviceId,
      deviceWorkspaceId: dispatchWorkspaceId,
      heteroType,
    });
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
