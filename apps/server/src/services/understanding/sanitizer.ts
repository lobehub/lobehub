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

const boundedCount = (value: number) =>
  Number.isFinite(value) ? Math.min(MAX_COLLECTION_COUNT, Math.max(0, Math.floor(value))) : 0;

const trustedProvider = (provider: string) =>
  provider.trim().slice(0, MAX_PROVIDER_ID_LENGTH) || 'provider';

/**
 * Normalizes a diagnostic identifier without retaining free-form text.
 *
 * Before:
 * - "gmail.search-failed"
 *
 * After:
 * - "GMAIL_SEARCH_FAILED"
 */
const normalizeDiagnosticCode = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, MAX_DIAGNOSTIC_CODE_LENGTH);

/**
 * Normalizes a provider sub-operation without retaining free-form text.
 *
 * Before:
 * - "Recent Messages"
 *
 * After:
 * - "recent_messages"
 */
const normalizeDiagnosticOperation = (value: string) =>
  value
    .trim()
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, MAX_DIAGNOSTIC_OPERATION_LENGTH) || 'collection';

const sanitizeDiagnosticCode = (provider: string, value: string) => {
  const normalized = normalizeDiagnosticCode(value);
  const providerPrefix = `${normalizeDiagnosticCode(provider)}_`;
  if (normalized.startsWith(providerPrefix) || normalized.startsWith('UNDERSTANDING_')) {
    return normalized;
  }
  return 'PROVIDER_COLLECTION_FAILED';
};

/**
 * Sanitizes provider diagnostics for persistence and observability.
 *
 * Use when:
 * - Moving provider collection diagnostics across the service boundary
 *
 * Expects:
 * - Codes are owned by the active provider or the Understanding service
 *
 * Returns:
 * - Bounded counts and identifiers with all free-form messages replaced
 */
export const sanitizeProviderDiagnostics = (
  provider: string,
  value: CollectionDiagnostics,
): CollectionDiagnostics => {
  const trusted = trustedProvider(provider);
  return {
    errors: value.errors.slice(0, MAX_COLLECTION_ERRORS).map((error) => {
      const code = sanitizeDiagnosticCode(trusted, error.code);
      const operation = normalizeDiagnosticOperation(error.operation);
      return {
        code,
        message: `${trusted} ${operation} failed`.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
        operation,
        provider: trusted,
        retryable: Boolean(error.retryable),
      };
    }),
    evidenceCount: boundedCount(value.evidenceCount),
    failedCount: boundedCount(value.failedCount),
    succeededCount: boundedCount(value.succeededCount),
  };
};

/**
 * Bounds diagnostics that were already sanitized by the service.
 *
 * Use when:
 * - Reading canonical diagnostics from a trusted internal result
 *
 * Expects:
 * - Error identifiers and messages are already canonical and non-sensitive
 *
 * Returns:
 * - Diagnostics with bounded counts and error cardinality
 */
export const boundCanonicalDiagnostics = (value: CollectionDiagnostics): CollectionDiagnostics => ({
  errors: value.errors.slice(0, MAX_COLLECTION_ERRORS),
  evidenceCount: boundedCount(value.evidenceCount),
  failedCount: boundedCount(value.failedCount),
  succeededCount: boundedCount(value.succeededCount),
});

/**
 * Creates one bounded collection error without retaining free-form messages.
 *
 * Use when:
 * - Converting a structured internal or Connector Data error for persistence
 *
 * Expects:
 * - The code is owned by the provider or the Understanding service
 *
 * Returns:
 * - A canonical collection error safe for storage, metrics, and API projection
 */
export const canonicalCollectionError = (
  provider: string,
  operation: string,
  code: string,
  retryable: boolean,
): CollectionError => {
  const trusted = trustedProvider(provider);
  const safeOperation = normalizeDiagnosticOperation(operation);
  return {
    code: sanitizeDiagnosticCode(trusted, code),
    message: `${trusted} ${safeOperation} failed`.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
    operation: safeOperation,
    provider: trusted,
    retryable,
  };
};
