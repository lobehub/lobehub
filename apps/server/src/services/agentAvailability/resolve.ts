import type {
  AgentAvailability,
  AgentAvailabilityStatus,
  ManagedDevicePhase,
} from '@lobechat/types';

/** One quota account's load, as `AgentQuotaService.resolveAccountLoads` reports it. */
export interface AvailabilityAccountLoad {
  enabled: boolean;
  rateLimitedUntil?: number | null;
  sessionUtil?: number;
  weeklyUtil?: number;
}

/** A limit is used up at or above this utilization, as the account balancer counts it. */
const EXHAUSTED = 100;

const isExhausted = (load: AvailabilityAccountLoad, now: number) =>
  (load.rateLimitedUntil != null && load.rateLimitedUntil > now) ||
  (load.weeklyUtil ?? 0) >= EXHAUSTED ||
  (load.sessionUtil ?? 0) >= EXHAUSTED;

/**
 * The Agent's quota has run out: it has accounts and none of the enabled ones
 * has headroom left. An Agent without accounts is not judged by quota at all.
 */
export const quotaExhaustion = (
  loads: AvailabilityAccountLoad[],
  now: number,
): { exhausted: boolean; resetsAt?: number } => {
  const enabled = loads.filter((load) => load.enabled);
  if (enabled.length === 0 || !enabled.every((load) => isExhausted(load, now)))
    return { exhausted: false };

  // A weekly limit carries no reset time here, so only promise one when every
  // account is benched by a session limit that says when it lifts.
  const resets = enabled.map((load) =>
    load.rateLimitedUntil != null && load.rateLimitedUntil > now ? load.rateLimitedUntil : null,
  );
  if (resets.some((reset) => reset === null)) return { exhausted: true };

  return { exhausted: true, resetsAt: Math.min(...(resets as number[])) };
};

/**
 * What a disconnected device is doing. A managed cloud device that is not
 * connected is usually asleep, not gone; one that failed or is being deleted
 * will not come back.
 */
const offlineStatus = (phase?: ManagedDevicePhase): AgentAvailabilityStatus => {
  switch (phase) {
    case 'suspended':
    case 'suspending': {
      return 'sleeping';
    }
    case 'pending':
    case 'running':
    case 'waking': {
      return 'waking';
    }
    default: {
      return 'offline';
    }
  }
};

export const resolveAgentAvailability = ({
  activeJobs,
  device,
  deviceId,
  loads,
  now,
}: {
  activeJobs: number;
  /** The bound device's presence, or `undefined` when the pool does not have it. */
  device?: { managedPhase?: ManagedDevicePhase; online: boolean };
  /** The device the Agent runs on for the caller; absent for a cloud Agent. */
  deviceId?: string;
  loads: AvailabilityAccountLoad[];
  now: number;
}): Omit<AgentAvailability, 'dispatchable'> => {
  if (deviceId && !device?.online)
    return { activeJobs, status: offlineStatus(device?.managedPhase) };
  // Off duty before working: a run already in flight keeps going, but no new work should land.
  const quota = quotaExhaustion(loads, now);
  if (quota.exhausted) return { activeJobs, resetsAt: quota.resetsAt, status: 'offDuty' };
  if (activeJobs > 0) return { activeJobs, status: 'working' };

  return { activeJobs, status: deviceId ? 'idle' : 'online' };
};
