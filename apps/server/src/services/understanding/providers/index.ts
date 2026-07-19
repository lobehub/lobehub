import type { UnderstandingSourceRef } from '@lobechat/types';

import type {
  CollectedUnderstandingSource,
  CredentialOrigin,
  IdentifiedUnderstandingSource,
  ResolvedUnderstandingSource,
  SourceCandidate,
  UnderstandingProvider,
  UnderstandingProviderContext,
  UnderstandingProviderRegistration,
} from '../types';
import { createGitHubUnderstandingProvider, githubUnderstandingRegistration } from './github';
import { createGmailUnderstandingProvider, gmailUnderstandingRegistration } from './gmail';

export interface RegisteredUnderstandingProvider {
  collect: (
    source: ResolvedUnderstandingSource,
    context: UnderstandingProviderContext,
  ) => Promise<CollectedUnderstandingSource>;
  discoverSources: (context: UnderstandingProviderContext) => Promise<SourceCandidate[]>;
  readonly id: string;
  identifySource: (
    candidate: SourceCandidate,
    context: UnderstandingProviderContext,
  ) => Promise<IdentifiedUnderstandingSource>;
  readonly originPriority: readonly CredentialOrigin[];
  readonly requiredScopes: readonly string[];
  resolveSource: (
    reference: UnderstandingSourceRef,
    locator: SourceCandidate,
    context: UnderstandingProviderContext,
  ) => Promise<ResolvedUnderstandingSource | null>;
  readonly usefulOptionalScopes: readonly string[];
}

export interface UnderstandingProviderRegistry {
  get: (provider: string) => RegisteredUnderstandingProvider | undefined;
  list: () => readonly RegisteredUnderstandingProvider[];
}

const registerUnderstandingProvider = (
  provider: UnderstandingProvider,
): RegisteredUnderstandingProvider => {
  const providerId = provider.id;
  const collect = provider.collect.bind(provider);
  const discoverSources = provider.discoverSources.bind(provider);
  const identifySource = provider.identifySource.bind(provider);
  const resolveSource =
    provider.resolveSource?.bind(provider) ??
    (async (
      reference: UnderstandingSourceRef,
      locator: SourceCandidate,
      context: UnderstandingProviderContext,
    ) => {
      if (locator.provider !== providerId) return null;
      const identified = await identifySource(locator, context);
      if (identified.externalAccountId !== reference.externalAccountId) return null;
      const resolved = {
        ...reference,
        candidateId: locator.candidateId,
        credentialOrigin: locator.credentialOrigin,
        credentialReference: locator.credentialReference,
        grantedScopes: [...new Set(identified.grantedScopes)].sort(),
      } as ResolvedUnderstandingSource;
      Object.defineProperty(resolved, 'credential', {
        configurable: false,
        enumerable: false,
        value: identified.credential,
        writable: false,
      });
      return resolved;
    });

  return Object.freeze({
    collect,
    discoverSources,
    id: providerId,
    identifySource,
    originPriority: Object.freeze([...provider.originPriority]),
    requiredScopes: Object.freeze([...provider.requiredScopes]),
    resolveSource,
    usefulOptionalScopes: Object.freeze([...provider.usefulOptionalScopes]),
  });
};

export const createUnderstandingProviderRegistry = (
  providers: readonly UnderstandingProvider[],
): UnderstandingProviderRegistry => {
  const entries = providers.map(registerUnderstandingProvider);
  const byProvider = new Map<string, RegisteredUnderstandingProvider>();

  for (const provider of entries) {
    if (byProvider.has(provider.id)) {
      throw new Error(`Understanding provider "${provider.id}" is already registered`);
    }
    byProvider.set(provider.id, provider);
  }

  return Object.freeze({
    get: byProvider.get.bind(byProvider),
    list: () => entries,
  });
};

// Credentials and recovery locators must never enter topic or message metadata.
export const toPublicUnderstandingSourceRef = (
  source: ResolvedUnderstandingSource,
): UnderstandingSourceRef => ({
  ...(source.displayName ? { displayName: source.displayName } : {}),
  externalAccountId: source.externalAccountId,
  id: source.id,
  provider: source.provider,
});

export const builtinUnderstandingProviderRegistrations = [
  githubUnderstandingRegistration,
  gmailUnderstandingRegistration,
] as const;

export const materializeUnderstandingProviders = (
  registrations: readonly UnderstandingProviderRegistration[],
  scope: Parameters<UnderstandingProviderRegistration['materialize']>[0],
) => {
  const providers: UnderstandingProvider[] = [];
  for (const registration of registrations) {
    const materialized = registration.materialize(scope);
    if (materialized.provider.id !== registration.id) {
      throw new Error(`Understanding registration id mismatch: ${registration.id}`);
    }
    providers.push(materialized.provider);
  }

  return {
    context: { userId: scope.userId, workspaceId: scope.workspaceId },
    registry: createUnderstandingProviderRegistry(providers),
  };
};

export {
  createGitHubUnderstandingProvider,
  createGmailUnderstandingProvider,
  githubUnderstandingRegistration,
  gmailUnderstandingRegistration,
};
