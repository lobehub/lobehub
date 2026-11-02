import type { SandboxState } from './initialState';
import {
  SANDBOX_SCOPE_ENTRY,
  type SandboxEntitlement,
  type SandboxPickerEnvironment,
  type SandboxPickerInstance,
} from './projection';

/** The active workspace's entitlement, or `undefined` before its first paint. */
const entitlement = (s: SandboxState): SandboxEntitlement | undefined =>
  s.sandboxEntitlementMap[SANDBOX_SCOPE_ENTRY];

/** The picker's environments, or `undefined` before their first paint. */
const pickerEnvironments = (s: SandboxState): SandboxPickerEnvironment[] | undefined =>
  s.sandboxEnvironmentsMap[SANDBOX_SCOPE_ENTRY];

/**
 * The picker's copies as `topicId` sees them, or `undefined` before their first
 * paint.
 *
 * The list is shared by every conversation and only "held by this
 * conversation" depends on which one asked. Until this topic's own answer
 * lands, a copy held by the conversation that last asked reads as held by
 * another one: the cautious reading, since the lease is real either way and
 * the refetch for this topic settles it.
 */
const pickerInstances =
  (topicId?: string) =>
  (s: SandboxState): SandboxPickerInstance[] | undefined => {
    const list = s.sandboxInstancesMap[SANDBOX_SCOPE_ENTRY];
    if (!list) return undefined;
    if (list.topicId === (topicId ?? null)) return list.instances;

    return list.instances.map((instance) =>
      instance.inUseByThisTopic ? { ...instance, inUseByThisTopic: false } : instance,
    );
  };

/**
 * A bound instance's directory: a string once known, `null` when the instance
 * is gone, `undefined` while unknown.
 */
const instanceDirectory =
  (instanceId?: string | null) =>
  (s: SandboxState): string | null | undefined =>
    instanceId ? s.sandboxInstanceDirectoryMap[instanceId]?.workingDirectory : undefined;

export const sandboxSelectors = {
  entitlement,
  instanceDirectory,
  pickerEnvironments,
  pickerInstances,
};
