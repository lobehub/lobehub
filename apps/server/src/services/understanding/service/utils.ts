import type { CollectionDiagnostics, CollectionError } from '@lobechat/types';
import {
  MAX_COLLECTION_COUNT,
  MAX_COLLECTION_ERRORS,
  OnboardingUnderstandingMessageMetadataSchema,
} from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

import type { StoredUnderstandingProviderContext } from '../sourceStore';
import { UnderstandingProviderContextUnavailableError } from './errors';

const BASELINE_MAX_LENGTH = 8_000;
const MAX_AGENT_INPUT_LENGTH = 128_000;

export const boundedCount = (value: number) =>
  Number.isFinite(value) ? Math.min(MAX_COLLECTION_COUNT, Math.max(0, Math.floor(value))) : 0;

/**
 * Bounds provider diagnostic counts without changing their error content.
 *
 * Use when:
 * - Moving provider collection diagnostics across the service boundary
 *
 * Expects:
 * - Providers return serializable CollectionError values
 *
 * Returns:
 * - Bounded counts and error cardinality with original diagnostics preserved
 */
export const boundProviderDiagnostics = (value: CollectionDiagnostics): CollectionDiagnostics => ({
  errors: value.errors.slice(0, MAX_COLLECTION_ERRORS),
  evidenceCount: boundedCount(value.evidenceCount),
  failedCount: boundedCount(value.failedCount),
  succeededCount: boundedCount(value.succeededCount),
});

/**
 * Creates one structured collection error while retaining its original message.
 *
 * Use when:
 * - Converting a structured internal or Connector Data error for persistence
 *
 * Expects:
 * - Provider, operation, and code are supplied by trusted internal code
 *
 * Returns:
 * - A collection error containing the supplied message without replacement
 */
export const createCollectionError = (
  provider: string,
  operation: string,
  code: string,
  retryable: boolean,
  message = `${provider} ${operation} failed`,
): CollectionError => ({ code, message, operation, provider, retryable });

export const buildEphemeralDocument = (
  contexts: StoredUnderstandingProviderContext[],
  baseline?: { persona?: string | null; tagline?: string | null } | null,
) => {
  const baselineContent = [baseline?.tagline, baseline?.persona]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n\n')
    .slice(0, BASELINE_MAX_LENGTH);
  const baselineSection = baselineContent
    ? `<current-persona-baseline>\n${baselineContent}\n</current-persona-baseline>\n\n`
    : '';
  const delimiters = contexts.map(({ providerId, revision }) => ({
    close: '\n</provider-context>',
    open: `<provider-context provider="${providerId}" revision="${revision}">\n`,
  }));
  const structuralLength =
    baselineSection.length +
    Math.max(0, contexts.length - 1) * 2 +
    delimiters.reduce(
      (total, delimiter) => total + delimiter.open.length + delimiter.close.length,
      0,
    );
  if (structuralLength > MAX_AGENT_INPUT_LENGTH) {
    throw new UnderstandingProviderContextUnavailableError();
  }
  let remainingContent = MAX_AGENT_INPUT_LENGTH - structuralLength;
  const providerSections = contexts.map(({ context }, index) => {
    const remainingProviders = contexts.length - index;
    const content = context.slice(0, Math.floor(remainingContent / remainingProviders));
    remainingContent -= content.length;
    return `${delimiters[index].open}${content}${delimiters[index].close}`;
  });
  return `${baselineSection}${providerSections.join('\n\n')}`;
};

export const storedProposal = (metadata: unknown) => {
  if (!isPlainRecord(metadata)) return;
  const parsed = OnboardingUnderstandingMessageMetadataSchema.safeParse(
    metadata.onboardingUnderstanding,
  );
  return parsed.success ? parsed.data : undefined;
};

/** Concurrency cap for per-provider source-store reads and session writes. */
export const PROVIDER_IO_CONCURRENCY = 5;
