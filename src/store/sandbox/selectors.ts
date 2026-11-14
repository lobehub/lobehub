import type { EnvironmentVisibility } from '@lobechat/types';

import type { SandboxState } from './initialState';
import {
  SANDBOX_SCOPE_ENTRY,
  type SandboxEntitlement,
  type SandboxEnvironment,
  type SandboxPickerEnvironment,
  type SandboxPickerInstance,
  toEnvironmentPool,
} from './projection';

/** The active workspace's entitlement, or `undefined` before its first paint. */
const entitlement = (s: SandboxState): SandboxEntitlement | undefined =>
  s.sandboxEntitlementMap[SANDBOX_SCOPE_ENTRY];

/**
 * One pool's environments (`visibility` omitted: every environment), or
 * `undefined` before their first paint.
 */
const environments =
  (visibility?: EnvironmentVisibility) =>
  (s: SandboxState): SandboxEnvironment[] | undefined =>
    s.sandboxEnvironmentsMap[toEnvironmentPool(visibility)];

/**
 * Whether the server has answered this pool since the page loaded. A list
 * restored from storage may be empty or out of date, so until then "no
 * environments" and "this one is gone" are not answers yet.
 */
const isEnvironmentsConfirmed =
  (visibility?: EnvironmentVisibility) =>
  (s: SandboxState): boolean => {
    const source = s.sandboxEnvironmentsReplica.entries[toEnvironmentPool(visibility)]?.source;

    return source === 'server' || source === 'local';
  };

/** The picker's environments, or `undefined` before their first paint. */
const pickerEnvironments = (s: SandboxState): SandboxPickerEnvironment[] | undefined =>
  s.sandboxEnvironmentsMap.all;

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
  environments,
  instanceDirectory,
  isEnvironmentsConfirmed,
  pickerEnvironments,
  pickerInstances,
};
