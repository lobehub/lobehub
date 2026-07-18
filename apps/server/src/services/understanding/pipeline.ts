import {
  type CollectionError,
  MAX_PROVIDER_ID_LENGTH,
  UnderstandingSourceRefSchema,
} from '@lobechat/types';

import type { RegisteredUnderstandingProvider, UnderstandingProviderRegistry } from './providers';
import type {
  IdentifiedUnderstandingSource,
  ResolvedUnderstandingSource,
  SourceCandidate,
  UnderstandingDiscoveryResult,
  UnderstandingProviderContext,
} from './types';
import { UnderstandingSourceIdentificationError } from './types';

interface IdentifiedCandidate {
  candidate: SourceCandidate;
  identified: IdentifiedUnderstandingSource;
  provider: RegisteredUnderstandingProvider;
}

const sanitizeProviderIdForError = (provider: string) =>
  provider.trim().slice(0, MAX_PROVIDER_ID_LENGTH) || 'provider';

const discoveryError = (provider: string): CollectionError => ({
  code: 'UNDERSTANDING_SOURCE_DISCOVERY_FAILED',
  message: `${sanitizeProviderIdForError(provider)} source discovery failed`,
  operation: 'discoverSources',
  provider: sanitizeProviderIdForError(provider),
  retryable: true,
});

const identificationError = (provider: string, retryable = false): CollectionError => ({
  code: 'UNDERSTANDING_SOURCE_IDENTIFICATION_FAILED',
  message: `A ${sanitizeProviderIdForError(provider)} source candidate could not be identified`,
  operation: 'identifySource',
  provider: sanitizeProviderIdForError(provider),
  retryable,
});

const originRank = (
  origin: SourceCandidate['credentialOrigin'],
  priority: readonly SourceCandidate['credentialOrigin'][],
) => {
  const rank = priority.indexOf(origin);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
};

const compareCandidates = (left: IdentifiedCandidate, right: IdentifiedCandidate) => {
  const leftScopes = new Set(left.identified.grantedScopes);
  const rightScopes = new Set(right.identified.grantedScopes);
  const requiredDifference =
    Number(right.provider.requiredScopes.every((scope) => rightScopes.has(scope))) -
    Number(left.provider.requiredScopes.every((scope) => leftScopes.has(scope)));
  if (requiredDifference !== 0) return requiredDifference;

  const optionalDifference =
    right.provider.usefulOptionalScopes.filter((scope) => rightScopes.has(scope)).length -
    left.provider.usefulOptionalScopes.filter((scope) => leftScopes.has(scope)).length;
  if (optionalDifference !== 0) return optionalDifference;

  const originDifference =
    originRank(left.candidate.credentialOrigin, left.provider.originPriority) -
    originRank(right.candidate.credentialOrigin, right.provider.originPriority);
  if (originDifference !== 0) return originDifference;

  return left.candidate.candidateId.localeCompare(right.candidate.candidateId);
};

const createResolvedSource = ({
  candidate,
  identified,
}: IdentifiedCandidate): ResolvedUnderstandingSource => {
  const source = {
    candidateId: candidate.candidateId,
    credentialOrigin: candidate.credentialOrigin,
    credentialReference: candidate.credentialReference,
    ...(identified.displayName ? { displayName: identified.displayName } : {}),
    externalAccountId: identified.externalAccountId,
    grantedScopes: [...new Set(identified.grantedScopes)].sort(),
    id: `${candidate.provider}:${identified.externalAccountId}`,
    provider: candidate.provider,
  } as ResolvedUnderstandingSource;

  Object.defineProperty(source, 'credential', {
    configurable: false,
    enumerable: false,
    value: identified.credential,
    writable: false,
  });
  return source;
};

export const discoverUnderstandingSources = async (
  registry: UnderstandingProviderRegistry,
  context: UnderstandingProviderContext,
): Promise<UnderstandingDiscoveryResult> => {
  const providers = registry.list();
  const discoveryResults = await Promise.allSettled(
    providers.map(async (provider) => provider.discoverSources(context)),
  );
  const errors: CollectionError[] = [];
  const candidates: Array<{
    candidate: SourceCandidate;
    provider: RegisteredUnderstandingProvider;
  }> = [];

  for (const [index, result] of discoveryResults.entries()) {
    const provider = providers[index];
    if (result.status === 'rejected') {
      errors.push(discoveryError(provider.id));
      continue;
    }
    for (const sourceCandidate of result.value) {
      if (sourceCandidate.provider !== provider.id) {
        errors.push(identificationError(provider.id));
        continue;
      }
      candidates.push({ candidate: sourceCandidate, provider });
    }
  }

  candidates.sort(
    (left, right) =>
      left.provider.id.localeCompare(right.provider.id) ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
  const identificationResults = await Promise.allSettled(
    candidates.map(async ({ candidate, provider }) => ({
      candidate,
      identified: await provider.identifySource(candidate, context),
      provider,
    })),
  );
  const identifiedCandidates: IdentifiedCandidate[] = [];

  for (const [index, result] of identificationResults.entries()) {
    if (result.status === 'fulfilled') {
      if (result.value.identified.externalAccountId.trim()) identifiedCandidates.push(result.value);
      else errors.push(identificationError(result.value.provider.id));
      continue;
    }
    errors.push(
      identificationError(
        candidates[index].provider.id,
        result.reason instanceof UnderstandingSourceIdentificationError
          ? result.reason.retryable
          : false,
      ),
    );
  }

  const grouped = new Map<string, IdentifiedCandidate[]>();
  for (const identifiedCandidate of identifiedCandidates) {
    const key = `${identifiedCandidate.provider.id}\u0000${identifiedCandidate.identified.externalAccountId}`;
    const group = grouped.get(key) ?? [];
    group.push(identifiedCandidate);
    grouped.set(key, group);
  }

  const sources: ResolvedUnderstandingSource[] = [];
  for (const group of grouped.values()) {
    const source = createResolvedSource(group.sort(compareCandidates)[0]);
    const publicReference = {
      ...(source.displayName ? { displayName: source.displayName } : {}),
      externalAccountId: source.externalAccountId,
      id: source.id,
      provider: source.provider,
    };
    if (!UnderstandingSourceRefSchema.safeParse(publicReference).success) {
      errors.push(identificationError(source.provider));
      continue;
    }
    sources.push(source);
  }
  sources.sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.externalAccountId.localeCompare(right.externalAccountId) ||
      left.candidateId.localeCompare(right.candidateId),
  );

  return {
    errors: errors.sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.operation.localeCompare(right.operation),
    ),
    sources,
  };
};
