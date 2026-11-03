import { useClientDataSWR } from '@/libs/swr';
import { evalKeys } from '@/libs/swr/keys';
import { agentEvalService } from '@/services/agentEval';

/** Connection pickers use the workspace-scoped SWR cache without duplicating credential state. */
export const createConnectorSlice = () => ({
  useFetchEvalConnectors: () =>
    useClientDataSWR(evalKeys.connectors(), () => agentEvalService.listEvalConnectors()),
  useFetchDatasetConnectorBindings: (datasetId?: string) =>
    useClientDataSWR(datasetId ? evalKeys.datasetConnectorBindings(datasetId) : null, () =>
      agentEvalService.getDatasetConnectorBindings(datasetId!),
    ),
});

export type ConnectorAction = ReturnType<typeof createConnectorSlice>;
