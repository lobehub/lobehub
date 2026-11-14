import { defineReplica } from '@/libs/replica';
import type { agentEvalService } from '@/services/agentEval';

export type EvalConnectorList = Awaited<ReturnType<typeof agentEvalService.listEvalConnectors>>;
export type EvalConnectorDetail = Awaited<ReturnType<typeof agentEvalService.getEvalConnector>>;
export type DatasetConnectorBindings = Awaited<
  ReturnType<typeof agentEvalService.getDatasetConnectorBindings>
>;

/**
 * Connections and bindings are memory only: they describe credentialed MCP
 * endpoints, and even redacted they stay out of the persisted cache.
 */

/** The connections of a dataset (`evalConnectorListMap[datasetId]`). */
export const evalConnectorListResource = defineReplica<string, EvalConnectorList>({
  key: (datasetId) => datasetId,
  name: 'evalConnectorList',
  storage: 'memory',
  version: 1,
});

/** One connection being edited (`evalConnectorDetailMap[connectorDetailKey(...)]`). */
export const connectorDetailKey = ({ datasetId, id }: { datasetId: string; id: string }) =>
  `${datasetId}:${id}`;

export const evalConnectorDetailResource = defineReplica<
  { datasetId: string; id: string },
  EvalConnectorDetail
>({
  key: connectorDetailKey,
  name: 'evalConnectorDetail',
  storage: 'memory',
  version: 1,
});

/** What a dataset's cases need and which connection serves each (`datasetConnectorBindingsMap`). */
export const datasetConnectorBindingsResource = defineReplica<string, DatasetConnectorBindings>({
  key: (datasetId) => datasetId,
  name: 'evalDatasetConnectorBindings',
  storage: 'memory',
  version: 1,
});
