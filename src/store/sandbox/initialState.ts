import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type {
  SandboxEntitlement,
  SandboxInstanceDirectory,
  SandboxPickerEnvironment,
  SandboxPickerInstanceList,
} from './projection';

export interface SandboxState {
  /** `sandboxEntitlementMap[SANDBOX_SCOPE_ENTRY]`: the active workspace's answer. */
  sandboxEntitlementMap: Record<string, SandboxEntitlement>;
  sandboxEntitlementReplica: ReplicaState<SandboxEntitlement>;
  /** `sandboxEnvironmentsMap[SANDBOX_SCOPE_ENTRY]`: the picker's environments. */
  sandboxEnvironmentsMap: Record<string, SandboxPickerEnvironment[]>;
  sandboxEnvironmentsReplica: ReplicaState<SandboxPickerEnvironment[]>;
  /** `sandboxInstanceDirectoryMap[instanceId]`: where a bound instance's files live. */
  sandboxInstanceDirectoryMap: Record<string, SandboxInstanceDirectory>;
  sandboxInstanceDirectoryReplica: ReplicaState<SandboxInstanceDirectory>;
  /** `sandboxInstancesMap[SANDBOX_SCOPE_ENTRY]`: the picker's copies. */
  sandboxInstancesMap: Record<string, SandboxPickerInstanceList>;
  sandboxInstancesReplica: ReplicaState<SandboxPickerInstanceList>;
}

export const initialState: SandboxState = {
  sandboxEntitlementMap: {},
  sandboxEntitlementReplica: createReplicaState(),
  sandboxEnvironmentsMap: {},
  sandboxEnvironmentsReplica: createReplicaState(),
  sandboxInstanceDirectoryMap: {},
  sandboxInstanceDirectoryReplica: createReplicaState(),
  sandboxInstancesMap: {},
  sandboxInstancesReplica: createReplicaState(),
};
