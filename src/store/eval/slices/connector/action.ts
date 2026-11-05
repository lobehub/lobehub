import { useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentEvalService } from '@/services/agentEval';

/** Connection pickers use the workspace-scoped SWR cache without duplicating credential state. */
export const createConnectorSlice = () => ({
  useFetchEvalConnectors: (datasetId?: string) =>
    useClientDataSWR(datasetId ? evalKeys.connectors(datasetId) : null, () =>
      agentEvalService.listEvalConnectors(datasetId!),
    ),
  useFetchEvalConnector: (datasetId: string, id?: string) =>
    useClientDataSWR(id ? evalKeys.connector(datasetId, id) : null, () =>
      agentEvalService.getEvalConnector(datasetId, id!),
    ),
  useFetchDatasetConnectorBindings: (datasetId?: string) =>
    useClientDataSWR(datasetId ? evalKeys.datasetConnectorBindings(datasetId) : null, () =>
      agentEvalService.getDatasetConnectorBindings(datasetId!),
    ),
});

export type ConnectorAction = ReturnType<typeof createConnectorSlice>;
