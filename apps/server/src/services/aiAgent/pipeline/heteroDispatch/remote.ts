import type { ExecAgentResult } from '@lobechat/types';
import debug from 'debug';

import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';

import {
  humanizeHeteroDispatchError,
  resolveHeteroDispatchErrorType,
} from '../../helpers/heteroErrors';
import type { ExecRunContext } from '../../types';
import type { HeteroDispatchDeps, HeteroDispatchInput, HeteroRun } from './types';
import { failHeteroDispatch } from './utils';

const log = debug('lobe-server:ai-agent-service');

/**
 * Notify-based platform agents (openclaw / hermes) communicate back via
 * agentNotify.notify. A local run uses the requesting desktop's device ID;
 * a remote run uses agencyConfig.boundDeviceId. Both use the gateway transport,
 * so open the stream before the first notify arrives.
 *
 * Returns the terminal error result when the run cannot start, `undefined`
 * once the device accepted it.
 */
export const dispatchToPlatformDevice = async (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  params: {
    agentConfig: ExecRunContext['agentConfig'];
    canUseDevice: boolean;
    deviceAccessReason: ExecRunContext['deviceAccessReason'];
    heteroType: HeteroDispatchInput['heteroType'];
    persistOperationMetadata: () => Promise<void>;
    prompt: string;
    remoteDeviceId?: string;
    remoteDeviceUserId: string;
    remoteDeviceWorkspaceId?: string;
    topicStartOwnerOperationId?: string;
  },
): Promise<ExecAgentResult | undefined> => {
  const {
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
  } = params;
  const { agentId: resolvedAgentId, assistantMessageId, operationId, topicId } = run;

  // Platform task agents require either this desktop or a connected device — there is no sandbox to
  // degrade to, so a denied sender (external bot user) is refused
  // outright instead of reaching the owner's machine.
  if (!canUseDevice) {
    log(
      'execAgent: device access denied for remote hetero dispatch (reason=%s)',
      deviceAccessReason,
    );
    return failHeteroDispatch(
      deps,
      run,
      {
        detail: 'This sender is not allowed to run agents on a bound device.',
        message: 'Device access denied',
      },
      { error: 'Device access denied', message: 'Remote hetero agent requires device access' },
    );
  }
  if (!remoteDeviceId) {
    log('execAgent: openclaw/hermes requires a local or connected device');
    return failHeteroDispatch(
      deps,
      run,
      {
        detail: 'No local or connected device is available for this agent.',
        message: 'No execution device for platform agent',
      },
      {
        error: 'No bound device',
        message: 'Platform agent requires a local or connected device',
      },
    );
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
  const authorizationError = await resolveDeviceDispatchAuthorizationFailure(
    deps.db,
    deps.userId,
    remoteDeviceId,
    remoteDeviceWorkspaceId,
  );
  const result = authorizationError
    ? {
        content: 'The workspace device is no longer registered or visible for this run.',
        error: 'DEVICE_NOT_FOUND',
        errorData: authorizationError,
        success: false,
      }
    : await deviceGateway.executeToolCall(
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
    return failHeteroDispatch(
      deps,
      run,
      {
        detail: result.error ?? 'Device dispatch failed',
        deviceRoute: remoteDeviceId
          ? {
              deviceId: remoteDeviceId,
              userId: remoteDeviceUserId,
              ...(remoteDeviceWorkspaceId ? { workspaceId: remoteDeviceWorkspaceId } : {}),
            }
          : undefined,
        errorData: result.errorData,
        errorType: resolveHeteroDispatchErrorType(result.error),
        message: humanizeHeteroDispatchError(result.error),
      },
      {
        error: result.error,
        errorData: result.errorData,
        message: 'Remote hetero agent dispatch failed',
      },
    );
  }

  return undefined;
};
