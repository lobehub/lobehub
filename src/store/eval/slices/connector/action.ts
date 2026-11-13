import { createReplicaSlice, recordLens } from '@/libs/replica';
import { agentEvalService } from '@/services/agentEval';
import { type ReplicaQueryResult, toReplicaQueryResult } from '@/store/eval/replicaQuery';
import { type EvalStore, useEvalStore } from '@/store/eval/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  connectorDetailKey,
  type DatasetConnectorBindings,
  datasetConnectorBindingsResource,
  type EvalConnectorDetail,
  evalConnectorDetailResource,
  type EvalConnectorList,
  evalConnectorListResource,
} from './projection';

const n = setNamespace('evalConnector');

type Setter = StoreSetter<EvalStore>;

export const createConnectorSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new ConnectorActionImpl(set, get, _api);

/** A dataset's connections and bindings, read by the connection pickers and editor. */
export class ConnectorActionImpl {
  readonly #bindings;
  readonly #detail;
  readonly #list;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#list = createReplicaSlice(evalConnectorListResource, {
      actionPrefix: n('list'),
      fetcher: (datasetId) => agentEvalService.listEvalConnectors(datasetId),
      get,
      set,
      stateKey: 'evalConnectorListReplica',
      view: recordLens<EvalStore, EvalConnectorList>('evalConnectorListMap'),
    });
    this.#detail = createReplicaSlice(evalConnectorDetailResource, {
      actionPrefix: n('detail'),
      fetcher: ({ datasetId, id }) => agentEvalService.getEvalConnector(datasetId, id),
      get,
      set,
      stateKey: 'evalConnectorDetailReplica',
      view: recordLens<EvalStore, EvalConnectorDetail>('evalConnectorDetailMap'),
    });
    this.#bindings = createReplicaSlice(datasetConnectorBindingsResource, {
      actionPrefix: n('bindings'),
      fetcher: (datasetId) => agentEvalService.getDatasetConnectorBindings(datasetId),
      get,
      set,
      stateKey: 'datasetConnectorBindingsReplica',
      view: recordLens<EvalStore, DatasetConnectorBindings>('datasetConnectorBindingsMap'),
    });
  }

  useFetchEvalConnectors = (datasetId?: string): ReplicaQueryResult<EvalConnectorList> => {
    const data = useEvalStore((s) => (datasetId ? s.evalConnectorListMap[datasetId] : undefined));
    const sync = this.#list.useSync(datasetId ?? null);
    return toReplicaQueryResult(sync, data, !!datasetId);
  };

  useFetchEvalConnector = (
    datasetId: string,
    id?: string,
  ): ReplicaQueryResult<EvalConnectorDetail> => {
    const params = id ? { datasetId, id } : null;
    const data = useEvalStore((s) =>
      params ? s.evalConnectorDetailMap[connectorDetailKey(params)] : undefined,
    );
    const sync = this.#detail.useSync(params);
    return toReplicaQueryResult(sync, data, !!params);
  };

  useFetchDatasetConnectorBindings = (
    datasetId?: string,
  ): ReplicaQueryResult<DatasetConnectorBindings> => {
    const data = useEvalStore((s) =>
      datasetId ? s.datasetConnectorBindingsMap[datasetId] : undefined,
    );
    const sync = this.#bindings.useSync(datasetId ?? null);
    return toReplicaQueryResult(sync, data, !!datasetId);
  };
}

export type ConnectorAction = Pick<ConnectorActionImpl, keyof ConnectorActionImpl>;
