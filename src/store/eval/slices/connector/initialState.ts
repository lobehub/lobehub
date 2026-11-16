import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type {
  DatasetConnectorBindings,
  EvalConnectorDetail,
  EvalConnectorList,
} from './projection';

export interface ConnectorSliceState {
  datasetConnectorBindingsMap: Record<string, DatasetConnectorBindings>;
  datasetConnectorBindingsReplica: ReplicaState<DatasetConnectorBindings>;
  evalConnectorDetailMap: Record<string, EvalConnectorDetail>;
  evalConnectorDetailReplica: ReplicaState<EvalConnectorDetail>;
  evalConnectorListMap: Record<string, EvalConnectorList>;
  evalConnectorListReplica: ReplicaState<EvalConnectorList>;
}

export const connectorInitialState: ConnectorSliceState = {
  datasetConnectorBindingsMap: {},
  datasetConnectorBindingsReplica: createReplicaState(),
  evalConnectorDetailMap: {},
  evalConnectorDetailReplica: createReplicaState(),
  evalConnectorListMap: {},
  evalConnectorListReplica: createReplicaState(),
};
