import { createReplicaSlice, recordLens } from '@/libs/replica';
import { scmService } from '@/services/scm';
import type { StoreSetter } from '@/store/types';

import type { IntegrationState } from './initialState';
import {
  type ScmConfig,
  scmConfigResource,
  type ScmIdentityEntry,
  scmIdentityResource,
  type ScmInstallationItem,
  scmInstallationsResource,
} from './projection';

type Setter = StoreSetter<IntegrationState>;

export class IntegrationPrivateAction {
  readonly scmConfig;
  readonly scmIdentity;
  readonly scmInstallations;

  constructor(set: Setter, get: () => IntegrationState) {
    this.scmConfig = createReplicaSlice(scmConfigResource, {
      actionPrefix: 'integration/scmConfig',
      fetcher: () => scmService.getConfig(),
      get,
      set,
      stateKey: 'scmConfigReplica',
      view: recordLens<IntegrationState, ScmConfig>('scmConfigMap'),
    });
    this.scmIdentity = createReplicaSlice(scmIdentityResource, {
      actionPrefix: 'integration/scmIdentity',
      fetcher: async () => ({ identity: await scmService.getIdentity('github') }),
      get,
      set,
      stateKey: 'scmIdentityReplica',
      view: recordLens<IntegrationState, ScmIdentityEntry>('scmIdentityMap'),
    });
    this.scmInstallations = createReplicaSlice(scmInstallationsResource, {
      actionPrefix: 'integration/scmInstallations',
      fetcher: () => scmService.listInstallations(),
      get,
      set,
      stateKey: 'scmInstallationsReplica',
      view: recordLens<IntegrationState, ScmInstallationItem[]>('scmInstallationsMap'),
    });
  }
}
