import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { getAgentOwnDevice } from '@/helpers/agentOwnDevice';

/**
 * Whether a project conversation runs in the cloud sandbox because its agent
 * fell back from a device of its own. A heterogeneous agent that runs on its
 * own device and may use the sandbox (Claude Code, Codex) only gets a project
 * conversation without a directory when that device could not take it — the
 * client stages its own device's directory otherwise
 * (`resolveAgentProjectRunner`), and the conversation's runner picker shows
 * the sandbox. The run must land there too, not on the agent's stored device:
 * the client's per-send target (`resolveProjectDirectoryRun`) does not reach
 * this server.
 *
 * Left alone: a conversation that already runs on a machine (a directory, a
 * pinned or requested device), and runs nobody started from the composer,
 * which keep the agent's own target. A composer send is the `chat` trigger
 * (`startComposerRun`); channels, tasks, schedules, goals, verification and
 * other server-started runs carry their own trigger, or are bots and share
 * visitors.
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
 * `agencyConfig` for this turn, moved to the sandbox when
 * {@link projectFallsBackToSandbox} says so. `run` is the turn's request; only
 * a `chat` trigger outside a task, schedule, bot or share visit is a composer send.
 */
export const withProjectSandboxFallback = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  run: {
    botContext?: unknown;
    cronJobId?: string;
    operationTaskId?: string;
    requestedDeviceId?: string;
    shareGate?: unknown;
    trigger?: string;
  },
  turn: { boundDeviceId: string | undefined; projectId: string | undefined },
): LobeAgentAgencyConfig | undefined =>
  projectFallsBackToSandbox({
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
  })
    ? { ...agencyConfig, executionTarget: 'sandbox' }
    : agencyConfig;
