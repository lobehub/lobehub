import { QUOTA_LIMITED_RUN_STATUS, TRANSIENT_FAILED_RUN_STATUS } from '@lobechat/const/goal';
import type { GoalGraphSnapshot } from '@lobechat/types';

import type { GoalEnvironmentProblem, GoalFailureClassification } from './failureClass';
import { classifyGoalFailure } from './failureClass';
import { countConsecutiveRunsWithStatus, QUOTA_RESET_MARGIN_MS } from './recoveryPolicy';

/**
 * How the coordinator recovers a Task stopped by a machine problem, mirroring the
 * offline-device schedule in `recoveryPolicy`: the run is not charged to the
 * attempt budget, so each class carries its own bound, and a person is asked
 * only once it is spent — with a gate that says what broke, not a judgment call.
 */

/**
 * Longest a Task waits on usage limits before a person is asked, measured from
 * the first limited run of the streak. A five-hour window that resets overnight
 * fits; a weekly limit days away does not, and is worth telling someone about.
 */
export const QUOTA_MAX_HOLD_MS = 26 * 60 * 60 * 1000;
/** Without a reset time the limit is retried on the offline-style backoff: 30m … 8h. */
export const QUOTA_FIRST_RETRY_DELAY_MS = 30 * 60 * 1000;
export const QUOTA_MAX_RETRY_DELAY_MS = 8 * 60 * 60 * 1000;
export const MAX_QUOTA_RETRIES = 6;
/**
 * Transient faults retry quickly and only a few times: one that survives three
 * fresh attempts across ~40 minutes is not transient any more.
 */
export const TRANSIENT_RETRY_DELAYS_MS = [2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000];

export type MachineRecoveryPlan =
  /** Not a machine problem: the judgment gate (or the supervisor) owns it. */
  | { action: 'none' }
  /** Retry now through the ordinary recovery path. */
  | { action: 'retry'; failureClass: 'quota' | 'transient' }
  /** Hold the Task; nothing to do until `retryAt`. */
  | {
      action: 'wait';
      failureClass: 'quota' | 'transient';
      /** When the failure being waited out happened. */
      failedAt: Date;
      message: string;
      retryAt: Date;
    }
  /** A person has to fix the setup; `reason` says what and is stable across ticks. */
  | { action: 'gate'; reason: string };

interface RunLike {
  status: string;
  updatedAt: Date | string;
}

const hours = (ms: number) => {
  const value = ms / 3_600_000;
  return value >= 10 ? `${Math.round(value)}h` : `${Math.round(value * 10) / 10}h`;
};

/** The fix a person makes for each environment problem, appended when the error does not say it. */
const environmentFix = (problem: GoalEnvironmentProblem): string => {
  switch (problem.kind) {
    case 'workingDirectory': {
      return `Create ${problem.path} on the device the agent runs on, or point the agent at a working directory that exists there`;
    }
    case 'cli': {
      return 'Install the CLI on the device the agent runs on and make sure it is on PATH';
    }
    case 'credentials': {
      return "Update the provider credentials, plan or model in the agent's settings";
    }
    case 'device': {
      return 'Reconnect the device (desktop app or `lh connect`), or bind the agent to another online device';
    }
    case 'gateway': {
      return 'Configure the device gateway on the server, or switch the agent to a connected local device';
    }
  }
};

const trimError = (error: string) => {
  const flat = error
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
  return flat.length > 300 ? `${flat.slice(0, 297)}...` : flat;
};

/** What the machine gate says for a setup problem: what broke, then what to change. */
export const describeEnvironmentGate = (error: string, problem: GoalEnvironmentProblem): string =>
  `Setup problem: ${trimError(error)}. ${environmentFix(problem)}`;

const nextQuotaRetryAt = (
  failure: GoalFailureClassification,
  failures: number,
  lastFailureAt: Date,
): Date => {
  if (failure.resetAt && failure.resetAt.getTime() > lastFailureAt.getTime())
    return new Date(failure.resetAt.getTime() + QUOTA_RESET_MARGIN_MS);
  const delay = Math.min(
    QUOTA_FIRST_RETRY_DELAY_MS * 2 ** (Math.max(1, failures) - 1),
    QUOTA_MAX_RETRY_DELAY_MS,
  );
  return new Date(lastFailureAt.getTime() + delay);
};

/**
 * Decide what to do with a Task paused on `error`.
 *
 * `runs` is the Task's run history newest first. A failure that left no run
 * behind (a dispatch that never started) counts as the first of its streak,
 * dated by the Task's own last update.
 */
export const planMachineRecovery = (params: {
  error: string | null | undefined;
  now: Date;
  runs: readonly RunLike[];
  taskUpdatedAt: Date | string;
}): MachineRecoveryPlan => {
  const { error, now, runs } = params;
  if (!error) return { action: 'none' };
  const { class: failureClass, problem } = classifyGoalFailure(error);

  if (failureClass === 'environment')
    return { action: 'gate', reason: describeEnvironmentGate(error, problem!) };
  if (failureClass === 'judgment') return { action: 'none' };

  const status = failureClass === 'quota' ? QUOTA_LIMITED_RUN_STATUS : TRANSIENT_FAILED_RUN_STATUS;
  const streak = countConsecutiveRunsWithStatus(runs, status);
  const failures = Math.max(1, streak);
  const lastFailureAt = streak ? new Date(runs[0].updatedAt) : new Date(params.taskUpdatedAt);
  const firstFailureAt = streak ? new Date(runs[streak - 1].updatedAt) : lastFailureAt;
  const retries = failures - 1;
  const spentFor = hours(lastFailureAt.getTime() - firstFailureAt.getTime());

  if (failureClass === 'quota') {
    // A wall-clock reset ("resets 4:30am") is the next one after the failure.
    const failure = classifyGoalFailure(error, lastFailureAt);
    const retryAt = nextQuotaRetryAt(failure, failures, lastFailureAt);
    if (retryAt.getTime() - firstFailureAt.getTime() > QUOTA_MAX_HOLD_MS) {
      return {
        action: 'gate',
        reason:
          retries === 0
            ? `Usage limit: ${trimError(error)}. It does not reset until ${retryAt.toISOString()}, more than a day away. Switch the agent to another account or provider, or retry after the reset`
            : `Usage limit: ${trimError(error)}. Retried ${retries} time(s) over ${spentFor} and the limit still applies. Check the plan or switch the agent to another account or provider`,
      };
    }
    if (retries >= MAX_QUOTA_RETRIES) {
      return {
        action: 'gate',
        reason: `Usage limit: ${trimError(error)}. Retried ${retries} time(s) over ${spentFor} and the limit still applies. Check the plan or switch the agent to another account or provider`,
      };
    }
    if (retryAt.getTime() <= now.getTime()) return { action: 'retry', failureClass: 'quota' };
    return {
      action: 'wait',
      failedAt: lastFailureAt,
      failureClass: 'quota',
      message: `Usage limit hit; retrying at ${retryAt.toISOString()}`,
      retryAt,
    };
  }

  if (retries >= TRANSIENT_RETRY_DELAYS_MS.length) {
    return {
      action: 'gate',
      reason: `Run failed: ${trimError(error)}. Retried ${retries} time(s) over ${spentFor} and it failed the same way each time. Check the device, its network and the agent gateway`,
    };
  }
  const retryAt = new Date(lastFailureAt.getTime() + TRANSIENT_RETRY_DELAYS_MS[retries]);
  if (retryAt.getTime() <= now.getTime()) return { action: 'retry', failureClass: 'transient' };
  return {
    action: 'wait',
    failedAt: lastFailureAt,
    failureClass: 'transient',
    message: `Transient failure; retrying at ${retryAt.toISOString()}`,
    retryAt,
  };
};

/**
 * When a person last answered a gate opened for this Task node. Their Retry is
 * a fresh start: runs before it belong to the schedule they already overrode,
 * so a limit hit again afterwards is waited out again instead of gating at once.
 */
export const lastAnsweredGateAt = (
  graph: Pick<GoalGraphSnapshot, 'decisions' | 'edges'>,
  nodeId: string,
): Date | undefined => {
  const gates = new Set(
    graph.edges
      .filter((edge) => edge.sourceNodeId === nodeId && edge.kind === 'leads_to')
      .map((edge) => edge.targetNodeId),
  );
  let latest: Date | undefined;
  for (const decision of graph.decisions) {
    if (!gates.has(decision.nodeId) || decision.status !== 'resolved' || !decision.resolvedAt)
      continue;
    const at = new Date(decision.resolvedAt);
    if (!latest || at > latest) latest = at;
  }
  return latest;
};
