import type {
  CollectionDiagnostics,
  CollectionError,
  UnderstandingSourceRef,
} from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';

export type CredentialOrigin = 'auth_account' | 'connector' | 'integration';

export class UnderstandingSourceIdentificationError extends Error {
  readonly retryable: boolean;

  constructor({ retryable }: { retryable: boolean }) {
    super('Understanding source identification failed');
    this.name = 'UnderstandingSourceIdentificationError';
    this.retryable = retryable;
  }
}

export interface UnderstandingProviderContext {
  userId: string;
  workspaceId?: string;
}

export interface SourceCandidate<Provider extends string = string> {
  candidateId: string;
  credentialOrigin: CredentialOrigin;
  credentialReference: string;
  provider: Provider;
}

export interface IdentifiedUnderstandingSource<Credential = unknown> {
  credential: Credential;
  displayName?: string;
  externalAccountId: string;
  grantedScopes: string[];
}

export interface ResolvedUnderstandingSource<Credential = unknown> extends UnderstandingSourceRef {
  candidateId: string;
  credential: Credential;
  credentialOrigin: CredentialOrigin;
  credentialReference: string;
  grantedScopes: string[];
}

export interface CollectedUnderstandingSource {
  diagnostics: CollectionDiagnostics;
  sourceBrief: string;
  sourceCount: number;
}

type ProviderRegistrationCallable<Arguments extends unknown[], Result> = {
  // Registration erases provider and credential generics after provider methods are bound.
  // eslint-disable-next-line @typescript-eslint/method-signature-style
  bivarianceHack(...arguments_: Arguments): Result;
}['bivarianceHack'];

export interface UnderstandingProvider<Provider extends string = string, Credential = unknown> {
  collect: ProviderRegistrationCallable<
    [source: ResolvedUnderstandingSource<Credential>, context: UnderstandingProviderContext],
    Promise<CollectedUnderstandingSource>
  >;
  discoverSources: (context: UnderstandingProviderContext) => Promise<SourceCandidate<Provider>[]>;
  id: Provider;
  identifySource: ProviderRegistrationCallable<
    [candidate: SourceCandidate<Provider>, context: UnderstandingProviderContext],
    Promise<IdentifiedUnderstandingSource<Credential>>
  >;
  originPriority: readonly CredentialOrigin[];
  requiredScopes: readonly string[];
  resolveSource?: ProviderRegistrationCallable<
    [
      reference: UnderstandingSourceRef,
      locator: SourceCandidate<Provider>,
      context: UnderstandingProviderContext,
    ],
    Promise<ResolvedUnderstandingSource<Credential> | null>
  >;
  usefulOptionalScopes: readonly string[];
}

export interface UnderstandingDiscoveryResult {
  errors: CollectionError[];
  sources: ResolvedUnderstandingSource[];
}

export interface UnderstandingProviderRegistration {
  id: string;
  materialize: (scope: { db: LobeChatDatabase; userId: string; workspaceId?: string }) => {
    provider: UnderstandingProvider;
  };
}
