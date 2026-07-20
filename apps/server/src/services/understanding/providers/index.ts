import { ConnectorDataError } from '@lobechat/connector-data';

import {
  MAX_COLLECTION_COUNT,
  MAX_SOURCE_BRIEF_LENGTH,
  sanitizeProviderDiagnostics,
} from '../sanitizer';
import type {
  CredentialOrigin,
  IdentifiedUnderstandingProviderCandidate,
  ResolvedUnderstandingProviderCandidate,
  UnderstandingProvider,
  UnderstandingProviderCandidate,
  UnderstandingProviderContext,
  UnderstandingProviderDefinition,
  UnderstandingProviderRegistration,
} from '../types';
import {
  UnderstandingProviderAuthorizationError,
  UnderstandingProviderRetryableError,
} from '../types';
import { createGitHubUnderstandingProvider, githubUnderstandingRegistration } from './github';
import { createGmailUnderstandingProvider, gmailUnderstandingRegistration } from './gmail';

export interface UnderstandingProviderRegistry {
  get: (provider: string) => UnderstandingProvider | undefined;
  list: () => readonly UnderstandingProvider[];
}

interface IdentifiedCandidate {
  candidate: UnderstandingProviderCandidate;
  identified: IdentifiedUnderstandingProviderCandidate;
}

const errorResult = (provider: string, code: string) => ({
  context: '',
  diagnostics: sanitizeProviderDiagnostics(provider, {
    errors: [{ code, message: '', operation: '', provider, retryable: false }],
    evidenceCount: 0,
    failedCount: 1,
    succeededCount: 0,
  }),
  sourceCount: 0,
});

const retryable = (error: unknown) =>
  (error instanceof ConnectorDataError && error.retryable) ||
  (error instanceof UnderstandingProviderAuthorizationError && error.retryable) ||
  (error instanceof UnderstandingProviderRetryableError && error.retryable);

const boundedCount = (value: number) =>
  Number.isFinite(value) ? Math.min(MAX_COLLECTION_COUNT, Math.max(0, Math.floor(value))) : 0;

const originRank = (origin: CredentialOrigin, priorities: readonly CredentialOrigin[]) => {
  const rank = priorities.indexOf(origin);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
};

const compareCandidates = (
  left: IdentifiedCandidate,
  right: IdentifiedCandidate,
  definition: UnderstandingProviderDefinition,
) => {
  const leftScopes = new Set(left.identified.grantedScopes);
  const rightScopes = new Set(right.identified.grantedScopes);
  const optionalDifference =
    definition.usefulOptionalScopes.filter((scope) => rightScopes.has(scope)).length -
    definition.usefulOptionalScopes.filter((scope) => leftScopes.has(scope)).length;
  if (optionalDifference !== 0) return optionalDifference;

  const originDifference =
    originRank(left.candidate.credentialOrigin, definition.originPriority) -
    originRank(right.candidate.credentialOrigin, definition.originPriority);
  if (originDifference !== 0) return originDifference;

  return left.candidate.candidateId.localeCompare(right.candidate.candidateId);
};

const resolveCandidate = async (
  definition: UnderstandingProviderDefinition,
  context: UnderstandingProviderContext,
): Promise<ResolvedUnderstandingProviderCandidate | null> => {
  let candidates: UnderstandingProviderCandidate[];
  try {
    candidates = (await definition.discoverCandidates(context)).filter(
      ({ provider }) => provider === definition.id,
    );
  } catch (error) {
    if (retryable(error)) throw new UnderstandingProviderRetryableError();
    return null;
  }
  if (candidates.length === 0) return null;

  const results = await Promise.allSettled(
    candidates.map(async (candidate) => ({
      candidate,
      identified: await definition.identifyCandidate(candidate, context),
    })),
  );
  if (results.some((result) => result.status === 'rejected' && retryable(result.reason))) {
    throw new UnderstandingProviderRetryableError();
  }
  const identified = results.flatMap((result) =>
    result.status === 'fulfilled' &&
    result.value.identified.externalAccountId.trim() &&
    definition.requiredScopes.every((scope) =>
      result.value.identified.grantedScopes.includes(scope),
    )
      ? [result.value]
      : [],
  );
  if (identified.length === 0) {
    return null;
  }

  const selected = identified.sort((left, right) => compareCandidates(left, right, definition))[0];
  const source = {
    candidateId: selected.candidate.candidateId,
    credentialOrigin: selected.candidate.credentialOrigin,
    credentialReference: selected.candidate.credentialReference,
    ...(selected.identified.displayName ? { displayName: selected.identified.displayName } : {}),
    externalAccountId: selected.identified.externalAccountId,
    grantedScopes: [...new Set(selected.identified.grantedScopes)].sort(),
    id: `${definition.id}:${selected.identified.externalAccountId}`,
    provider: definition.id,
  } as ResolvedUnderstandingProviderCandidate;
  Object.defineProperty(source, 'credential', {
    configurable: false,
    enumerable: false,
    value: selected.identified.credential,
    writable: false,
  });
  return source;
};

const registerUnderstandingProvider = (
  definition: UnderstandingProviderDefinition,
): UnderstandingProvider =>
  Object.freeze({
    collect: async (context: UnderstandingProviderContext) => {
      let source: ResolvedUnderstandingProviderCandidate | null;
      try {
        source = await resolveCandidate(definition, context);
      } catch (error) {
        if (retryable(error)) throw new UnderstandingProviderRetryableError();
        return errorResult(definition.id, 'UNDERSTANDING_PROVIDER_RESOLUTION_FAILED');
      }
      if (!source) {
        return errorResult(definition.id, 'UNDERSTANDING_PROVIDER_AUTHORIZATION_FAILED');
      }

      try {
        const collected = await definition.collect(source, context);
        return {
          context: collected.context.trim().slice(0, MAX_SOURCE_BRIEF_LENGTH),
          diagnostics: sanitizeProviderDiagnostics(definition.id, collected.diagnostics),
          sourceCount: boundedCount(collected.sourceCount),
        };
      } catch (error) {
        if (retryable(error)) throw new UnderstandingProviderRetryableError();
        return errorResult(definition.id, 'UNDERSTANDING_PROVIDER_COLLECTION_FAILED');
      }
    },
    id: definition.id,
  });

export const createUnderstandingProviderRegistry = (
  definitions: readonly UnderstandingProviderDefinition[],
): UnderstandingProviderRegistry => {
  const providers = definitions.map(registerUnderstandingProvider);
  const byProvider = new Map<string, UnderstandingProvider>();
  for (const provider of providers) {
    if (byProvider.has(provider.id)) {
      throw new Error(`Understanding provider "${provider.id}" is already registered`);
    }
    byProvider.set(provider.id, provider);
  }
  return Object.freeze({
    get: byProvider.get.bind(byProvider),
    list: () => providers,
  });
};

export const builtinUnderstandingProviderRegistrations = [
  githubUnderstandingRegistration,
  gmailUnderstandingRegistration,
] as const;

export const materializeUnderstandingProviders = (
  registrations: readonly UnderstandingProviderRegistration[],
  scope: Parameters<UnderstandingProviderRegistration['materialize']>[0],
) => {
  const definitions: UnderstandingProviderDefinition[] = [];
  for (const registration of registrations) {
    const materialized = registration.materialize(scope);
    if (materialized.provider.id !== registration.id) {
      throw new Error(`Understanding registration id mismatch: ${registration.id}`);
    }
    definitions.push(materialized.provider);
  }
  return {
    context: { userId: scope.userId, workspaceId: scope.workspaceId },
    registry: createUnderstandingProviderRegistry(definitions),
  };
};

export {
  createGitHubUnderstandingProvider,
  createGmailUnderstandingProvider,
  githubUnderstandingRegistration,
  gmailUnderstandingRegistration,
};
