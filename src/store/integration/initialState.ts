import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { ScmConfig, ScmIdentityEntry, ScmInstallationItem } from './projection';

export interface IntegrationState {
  scmConfigMap: Record<string, ScmConfig>;
  scmConfigReplica: ReplicaState<ScmConfig>;
  scmIdentityMap: Record<string, ScmIdentityEntry>;
  scmIdentityReplica: ReplicaState<ScmIdentityEntry>;
  scmInstallationsMap: Record<string, ScmInstallationItem[]>;
  scmInstallationsReplica: ReplicaState<ScmInstallationItem[]>;
}

export const initialIntegrationState: IntegrationState = {
  scmConfigMap: {},
  scmConfigReplica: createReplicaState(),
  scmIdentityMap: {},
  scmIdentityReplica: createReplicaState(),
  scmInstallationsMap: {},
  scmInstallationsReplica: createReplicaState(),
};
