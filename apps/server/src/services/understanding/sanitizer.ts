import {
  type CollectionDiagnostics,
  type CollectionError,
  MAX_COLLECTION_COUNT,
  MAX_COLLECTION_ERRORS,
  MAX_DIAGNOSTIC_CODE_LENGTH,
  MAX_DIAGNOSTIC_MESSAGE_LENGTH,
  MAX_DIAGNOSTIC_OPERATION_LENGTH,
  MAX_PROVIDER_ID_LENGTH,
} from '@lobechat/types';

export {
  MAX_COLLECTION_COUNT,
  MAX_COLLECTION_ERRORS,
  MAX_DIAGNOSTIC_CODE_LENGTH,
  MAX_DIAGNOSTIC_MESSAGE_LENGTH,
  MAX_DIAGNOSTIC_OPERATION_LENGTH,
  MAX_PROVIDER_ID_LENGTH,
} from '@lobechat/types';

export const MAX_AGENT_INPUT_LENGTH = 128_000;
export const MAX_SOURCE_BRIEF_LENGTH = 64_000;

const canonicalErrors: Record<string, { code: string; operation: string }> = {
  GITHUB_CONTRIBUTORS_FAILED: {
    code: 'GITHUB_CONTRIBUTORS_FAILED',
    operation: 'contributors',
  },
  GITHUB_ORGANIZATIONS_FAILED: {
    code: 'GITHUB_ORGANIZATIONS_FAILED',
    operation: 'organizations',
  },
  GITHUB_PINNED_REPOSITORIES_FAILED: {
    code: 'GITHUB_PINNED_REPOSITORIES_FAILED',
    operation: 'pinned_repositories',
  },
  GITHUB_PROFILE_README_FAILED: {
    code: 'GITHUB_PROFILE_README_FAILED',
    operation: 'profile_readme',
  },
  GITHUB_RECENT_CONTRIBUTIONS_FAILED: {
    code: 'GITHUB_RECENT_CONTRIBUTIONS_FAILED',
    operation: 'recent_contributions',
  },
  GITHUB_RECENT_PULL_REQUESTS_FAILED: {
    code: 'GITHUB_RECENT_PULL_REQUESTS_FAILED',
    operation: 'recent_pull_requests',
  },
  GITHUB_RECENT_REPOSITORIES_FAILED: {
    code: 'GITHUB_RECENT_REPOSITORIES_FAILED',
    operation: 'recent_repositories',
  },
  GMAIL_SEARCH_FAILED: { code: 'GMAIL_SEARCH_FAILED', operation: 'search' },
  UNDERSTANDING_PROVIDER_AUTHORIZATION_FAILED: {
    code: 'UNDERSTANDING_PROVIDER_AUTHORIZATION_FAILED',
    operation: 'authorize',
  },
  UNDERSTANDING_PROVIDER_COLLECTION_FAILED: {
    code: 'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
    operation: 'collect',
  },
  UNDERSTANDING_PROVIDER_RESOLUTION_FAILED: {
    code: 'UNDERSTANDING_PROVIDER_RESOLUTION_FAILED',
    operation: 'resolve',
  },
};

const boundedCount = (value: number) =>
  Number.isFinite(value) ? Math.min(MAX_COLLECTION_COUNT, Math.max(0, Math.floor(value))) : 0;

const trustedProvider = (provider: string) =>
  provider.trim().slice(0, MAX_PROVIDER_ID_LENGTH) || 'provider';

export const sanitizeProviderDiagnostics = (
  provider: string,
  value: CollectionDiagnostics,
): CollectionDiagnostics => {
  const trusted = trustedProvider(provider);
  return {
    errors: value.errors.slice(0, MAX_COLLECTION_ERRORS).map((error) => {
      const canonical = canonicalErrors[error.code] ?? {
        code: 'PROVIDER_COLLECTION_FAILED',
        operation: 'collection',
      };
      return {
        code: canonical.code.slice(0, MAX_DIAGNOSTIC_CODE_LENGTH),
        message: `${trusted} ${canonical.operation} failed`.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
        operation: canonical.operation.slice(0, MAX_DIAGNOSTIC_OPERATION_LENGTH),
        provider: trusted,
        retryable: Boolean(error.retryable),
      };
    }),
    evidenceCount: boundedCount(value.evidenceCount),
    failedCount: boundedCount(value.failedCount),
    succeededCount: boundedCount(value.succeededCount),
  };
};

export const boundCanonicalDiagnostics = (value: CollectionDiagnostics): CollectionDiagnostics => ({
  errors: value.errors.slice(0, MAX_COLLECTION_ERRORS),
  evidenceCount: boundedCount(value.evidenceCount),
  failedCount: boundedCount(value.failedCount),
  succeededCount: boundedCount(value.succeededCount),
});

export const canonicalCollectionError = (
  provider: string,
  operation: string,
  code: string,
  retryable: boolean,
): CollectionError => {
  const trusted = trustedProvider(provider);
  const safeOperation = operation.slice(0, MAX_DIAGNOSTIC_OPERATION_LENGTH);
  return {
    code: code.slice(0, MAX_DIAGNOSTIC_CODE_LENGTH),
    message: `${trusted} ${safeOperation} failed`.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
    operation: safeOperation,
    provider: trusted,
    retryable,
  };
};
