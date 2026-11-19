import type {
  AgentAvailability,
  AgentAvailabilityStatus,
  ManagedDevicePhase,
} from '@lobechat/types';

/** Whether an agent's quota is spent where it runs; see `AgentQuotaService.resolveAgentAvailability`. */
export interface AvailabilityQuota {
  exhausted: boolean;
  /** When the first account comes back (ms), if a limit says so. */
  resetsAt?: number;
}

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
  quota,
}: {
  activeJobs: number;
  /** The bound device's presence, or `undefined` when the pool does not have it. */
  device?: { managedPhase?: ManagedDevicePhase; online: boolean };
  /** The device the Agent runs on for the caller; absent for a cloud Agent. */
  deviceId?: string;
  /** Absent when it could not be read: "off duty" is then not ruled in. */
  quota?: AvailabilityQuota;
}): Omit<AgentAvailability, 'dispatchable'> => {
  if (deviceId && !device?.online)
    return { activeJobs, status: offlineStatus(device?.managedPhase) };
  // Off duty before working: a run already in flight keeps going, but no new work should land.
  if (quota?.exhausted) return { activeJobs, resetsAt: quota.resetsAt, status: 'offDuty' };
  if (activeJobs > 0) return { activeJobs, status: 'working' };

  return { activeJobs, status: deviceId ? 'idle' : 'online' };
};
