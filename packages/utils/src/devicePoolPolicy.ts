import type {
  DevicePoolDecision,
  DevicePoolMatrix,
  DevicePoolPolicy,
  DevicePoolSubject,
  DevicePoolTrigger,
} from '@lobechat/types';

/** Facts required to evaluate one pool; identity matching is supplied by the server. */
export interface EvaluateDevicePoolUseInput {
  /** Whether the verified caller owns the device in the active scope. @default false */
  isDeviceOwner?: boolean;
  /** Optional override for the exact Agent and pool. */
  override?: DevicePoolMatrix;
  /** Current persisted policy. */
  policy: DevicePoolPolicy;
  /** Applicable identities in descending precedence, e.g. Workspace member, Everyone. */
  subjects: readonly DevicePoolSubject[];
  /** Root entry type, preserved across child runs. */
  trigger: DevicePoolTrigger;
}

/**
 * Evaluates one complete pool authorization path without IO.
 *
 * Use when:
 * - Discovery, dispatch, or a policy preview needs the same decision
 *
 * Expects:
 * - Subjects are trusted and ordered by specificity
 * - Override belongs to the requested Agent and pool
 *
 * Returns:
 * - An explainable allow/deny result; unspecified rules ultimately deny
 */
export function evaluateDevicePoolUse({
  policy,
  isDeviceOwner = false,
  override,
  trigger,
  subjects,
}: EvaluateDevicePoolUseInput): DevicePoolDecision {
  if (policy.blockedTriggers.includes(trigger)) return { allowed: false, source: 'hard-limit' };

  for (const [matrix, source] of [
    [override, 'agent-override'],
    [policy.rules, 'pool-rule'],
  ] as const) {
    for (const subject of subjects) {
      const effect = matrix?.[trigger]?.[subject];
      if (effect === 'allow' || effect === 'deny') {
        return { allowed: effect === 'allow', source, subject };
      }
    }
  }

  if (policy.everyone !== 'inherit') {
    return { allowed: policy.everyone === 'allow', source: 'pool-default', subject: 'everyone' };
  }
  return { allowed: isDeviceOwner && trigger !== 'bot', source: 'system-default' };
}

/**
 * Creates a conservative policy for a new pool.
 *
 * Use when:
 * - A user creates a personal or workspace pool
 *
 * Expects:
 * - Device ownership is provided separately by the server
 *
 * Returns:
 * - All identities inherit: device owners get Chat/Task by default, and Bot is denied
 */
export function createDevicePoolPolicy(): DevicePoolPolicy {
  return {
    blockedTriggers: [],
    everyone: 'inherit',
    rules: {},
  };
}
