import type { CollectionDiagnostics } from '@lobechat/types';

import type { ConnectorDataService } from '@/server/services/connectorData';

export interface CollectedUnderstandingProviderContext {
  context: string;
  diagnostics: CollectionDiagnostics;
  sourceCount: number;
}

export interface UnderstandingProvider {
  collect: (input: {
    connectorData: ConnectorDataService;
    userId: string;
  }) => Promise<CollectedUnderstandingProviderContext>;
  readonly id: string;
}
