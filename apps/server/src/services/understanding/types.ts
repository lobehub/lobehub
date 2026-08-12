import type { CollectionDiagnostics } from '@lobechat/types';

import type { ConnectorDataService } from '@/server/services/connectorData';

/** Evidence and collection metadata returned by one Understanding provider. */
export interface CollectedUnderstandingProviderContext {
  /** Prompt-ready evidence collected from the provider. */
  context: string;
  /** Structured diagnostics for partial or failed collection attempts. */
  diagnostics: CollectionDiagnostics;
  /** Number of source records represented in {@link context}. */
  sourceCount: number;
}

/** Connection system used by onboarding to authorize one Understanding provider. */
export type UnderstandingProviderConnectionSource = 'composio' | 'lobehub';

/** Registry contract for a provider that contributes onboarding Understanding evidence. */
export interface UnderstandingProvider {
  /** Collects prompt-ready evidence for the current user. */
  collect: (input: {
    connectorData: ConnectorDataService;
    userId: string;
  }) => Promise<CollectedUnderstandingProviderContext>;
  /** Frontend connection system that owns this provider's OAuth lifecycle. */
  readonly connectionSource: UnderstandingProviderConnectionSource;
  readonly id: string;
}
