import type { CollectionDiagnostics } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';

export type CredentialOrigin = 'auth_account' | 'connector' | 'integration';

export class UnderstandingProviderAuthorizationError extends Error {
  readonly retryable: boolean;

  constructor({ retryable }: { retryable: boolean }) {
    super('Understanding provider authorization failed');
    this.name = 'UnderstandingProviderAuthorizationError';
    this.retryable = retryable;
  }
}

export class UnderstandingProviderRetryableError extends Error {
  readonly retryable = true;

  constructor() {
    super('Understanding provider operation is temporarily unavailable');
    this.name = 'UnderstandingProviderRetryableError';
  }
}

export interface UnderstandingProviderContext {
  userId: string;
  workspaceId?: string;
}

export interface UnderstandingProviderCandidate<Provider extends string = string> {
  candidateId: string;
  credentialOrigin: CredentialOrigin;
  credentialReference: string;
  provider: Provider;
}

export interface IdentifiedUnderstandingProviderCandidate<Credential = unknown> {
  credential: Credential;
  displayName?: string;
  externalAccountId: string;
  grantedScopes: string[];
}

export interface ResolvedUnderstandingProviderCandidate<Credential = unknown>
  extends
    UnderstandingProviderCandidate,
    Omit<IdentifiedUnderstandingProviderCandidate<Credential>, 'credential'> {
  credential: Credential;
  id: string;
}

export interface CollectedUnderstandingProviderContext {
  context: string;
  diagnostics: CollectionDiagnostics;
  sourceCount: number;
}

type ProviderRegistrationCallable<Arguments extends unknown[], Result> = {
  // Registration erases provider and credential generics after provider methods are bound.
  // eslint-disable-next-line @typescript-eslint/method-signature-style
  bivarianceHack(...arguments_: Arguments): Result;
}['bivarianceHack'];

export interface UnderstandingProviderDefinition<
  Provider extends string = string,
  Credential = unknown,
> {
  collect: ProviderRegistrationCallable<
    [
      source: ResolvedUnderstandingProviderCandidate<Credential>,
      context: UnderstandingProviderContext,
    ],
    Promise<CollectedUnderstandingProviderContext>
  >;
  discoverCandidates: (
    context: UnderstandingProviderContext,
  ) => Promise<UnderstandingProviderCandidate<Provider>[]>;
  id: Provider;
  identifyCandidate: ProviderRegistrationCallable<
    [candidate: UnderstandingProviderCandidate<Provider>, context: UnderstandingProviderContext],
    Promise<IdentifiedUnderstandingProviderCandidate<Credential>>
  >;
  originPriority: readonly CredentialOrigin[];
  requiredScopes: readonly string[];
  usefulOptionalScopes: readonly string[];
}

export interface UnderstandingProvider {
  collect: (
    context: UnderstandingProviderContext,
  ) => Promise<CollectedUnderstandingProviderContext>;
  readonly id: string;
}

export interface UnderstandingProviderRegistration {
  id: string;
  materialize: (scope: { db: LobeChatDatabase; userId: string; workspaceId?: string }) => {
    provider: UnderstandingProviderDefinition;
  };
}
