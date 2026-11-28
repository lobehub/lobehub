import type { ChatTopicMetadata, LobeAgentAgencyConfig } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { getAgentOwnDevice } from '@/helpers/agentOwnDevice';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import type { TurnSetupDeps } from './turnSetup';

/**
 * Whether a project conversation is one whose agent might fall back to the
 * cloud sandbox from a device of its own: a composer send of a project
 * conversation with no directory, no pinned or requested device, by a
 * heterogeneous agent that runs on its own device and may use the sandbox
 * (Claude Code, Codex).
 *
 * Such a conversation runs on that device in the agent's own working
 * directory while the device is online — the client stages its own device's
 * project folder when there is one (`resolveAgentProjectRunner`) — and in the
 * sandbox when it is not ({@link withProjectSandboxFallback}).
 *
 * Left alone: runs nobody started from the composer, which keep the agent's own
 * target. A composer send is the `chat` trigger (`startComposerRun`); channels,
 * tasks, schedules, goals, verification and other server-started runs carry
 * their own trigger, or are bots and share visitors.
 */
export const projectFallsBackToSandbox = ({
  agencyConfig,
  boundDeviceId,
  interactive,
  projectId,
  requestedDeviceId,
}: {
  agencyConfig: LobeAgentAgencyConfig | undefined;
  /** The device this turn is already pinned to (directory, topic pin, fixed target). */
  boundDeviceId: string | undefined;
  interactive: boolean;
  projectId: string | undefined;
  requestedDeviceId: string | undefined;
}) =>
  interactive &&
  !!projectId &&
  !boundDeviceId &&
  !requestedDeviceId &&
  !!getAgentOwnDevice(agencyConfig)?.sandboxFallback;

/**
 * `agencyConfig` for this turn. A conversation that may fall back
 * ({@link projectFallsBackToSandbox}) runs in the sandbox once it has done so
 * (`metadata.projectSandboxFallback`), or when the agent's own device is
 * offline on a turn that never ran on a machine — which then marks the
 * conversation, so its later turns stay where its session lives. While the
 * device is online it keeps the agent's own target: its device, in its own
 * working directory.
 *
 * `run` is the turn's request; only a `chat` trigger outside a task, schedule,
 * bot or share visit is a composer send.
 */
export const withProjectSandboxFallback = async (
  deps: Pick<TurnSetupDeps, 'db' | 'topicModel' | 'userId' | 'workspaceId'>,
  run: {
    botContext?: unknown;
    cronJobId?: string;
    operationTaskId?: string;
    requestedDeviceId?: string;
    shareGate?: unknown;
    trigger?: string;
  },
  { agencyConfig }: { agencyConfig?: LobeAgentAgencyConfig },
  turn: { boundDeviceId: string | undefined; projectId: string | undefined; topicId?: string },
): Promise<LobeAgentAgencyConfig | undefined> => {
  const mayFallBack = projectFallsBackToSandbox({
    agencyConfig,
    boundDeviceId: turn.boundDeviceId,
    interactive:
      run.trigger === RequestTrigger.Chat &&
      !run.operationTaskId &&
      !run.cronJobId &&
      !run.botContext &&
      !run.shareGate,
    projectId: turn.projectId,
    requestedDeviceId: run.requestedDeviceId,
  });
  if (!mayFallBack || !turn.topicId) return agencyConfig;

  const sandboxed = { ...agencyConfig, executionTarget: 'sandbox' as const };
  const topic = await deps.topicModel.findById(turn.topicId);
  const metadata = topic?.metadata as ChatTopicMetadata | null | undefined;
  if (metadata?.projectSandboxFallback) return sandboxed;
  // It already ran on a machine: it stays there. (The turn's pin is not taken
  // from a topic another agent owns, so the row itself is checked too.)
  if (metadata?.boundDeviceId) return agencyConfig;

  // Decided at turn setup: a device that drops before the dispatch fails this
  // run (as any device run would) rather than falling back mid-send.
  const deviceId = getAgentOwnDevice(agencyConfig)!.deviceId;
  const online = await getScopedOnlineDevices(deps.db, deps.userId, deps.workspaceId)
    .then((devices) => devices.some((device) => device.deviceId === deviceId && device.online))
    // Presence unknown: leave it to the device route, which reports an offline device.
    .catch(() => true);
  if (online) return agencyConfig;

  await deps.topicModel.updateMetadata(turn.topicId, { projectSandboxFallback: true });
  return sandboxed;
};
