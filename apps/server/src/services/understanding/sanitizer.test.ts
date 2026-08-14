import type { CollectionDiagnostics } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { canonicalCollectionError, sanitizeProviderDiagnostics } from './sanitizer';

/** @example describe('sanitizeProviderDiagnostics', () => {}); */
describe('sanitizeProviderDiagnostics', () => {
  /** @example expect(result.errors[0].code).toBe('GMAIL_READ_PERMISSION_REQUIRED'); */
  it('preserves bounded provider-owned codes and operations while replacing messages', () => {
    // ROOT CAUSE:
    //
    // A fixed diagnostic allowlist converted new internal codes such as
    // GMAIL_READ_PERMISSION_REQUIRED into PROVIDER_COLLECTION_FAILED. This erased the exact
    // business failure needed for persisted diagnostics and observability.
    //
    // We fixed this by accepting bounded identifiers in the active provider namespace while still
    // replacing free-form messages at the service boundary.
    const diagnostics: CollectionDiagnostics = {
      errors: [
        {
          code: 'GMAIL_READ_PERMISSION_REQUIRED',
          message: 'secret upstream response must not survive',
          operation: 'permission',
          provider: 'untrusted-provider',
          retryable: false,
        },
      ],
      evidenceCount: 0,
      failedCount: 1,
      succeededCount: 0,
    };

    const result = sanitizeProviderDiagnostics('gmail', diagnostics);

    /** @example expect(result.errors[0]).not.toHaveProperty('message', 'secret'); */
    expect(result.errors).toEqual([
      {
        code: 'GMAIL_READ_PERMISSION_REQUIRED',
        message: 'gmail permission failed',
        operation: 'permission',
        provider: 'gmail',
        retryable: false,
      },
    ]);
  });

  /** @example expect(result.errors[0].code).toBe('PROVIDER_COLLECTION_FAILED'); */
  it('rejects codes outside the active provider namespace', () => {
    const result = sanitizeProviderDiagnostics('gmail', {
      errors: [
        {
          code: 'UPSTREAM_SECRET_ACCOUNT_IDENTIFIER',
          message: 'raw provider message',
          operation: 'Recent Messages',
          provider: 'gmail',
          retryable: true,
        },
      ],
      evidenceCount: 0,
      failedCount: 1,
      succeededCount: 0,
    });

    /** @example expect(result.errors[0].operation).toBe('recent_messages'); */
    expect(result.errors[0]).toEqual({
      code: 'PROVIDER_COLLECTION_FAILED',
      message: 'gmail recent_messages failed',
      operation: 'recent_messages',
      provider: 'gmail',
      retryable: true,
    });
  });

  /** @example expect(error.code).toBe('GMAIL_SEARCH_FAILED'); */
  it('normalizes safe connector error codes before persistence', () => {
    const error = canonicalCollectionError('gmail', 'searchMessages', 'gmail_search_failed', true);

    /** @example expect(error.message).toBe('gmail search_messages failed'); */
    expect(error).toEqual({
      code: 'GMAIL_SEARCH_FAILED',
      message: 'gmail search_messages failed',
      operation: 'search_messages',
      provider: 'gmail',
      retryable: true,
    });
  });

  /** @example expect(error.code).toBe('UNDERSTANDING_WRITING_FAILED'); */
  it('preserves Understanding-owned workflow error codes', () => {
    const error = canonicalCollectionError(
      'understanding',
      'writing',
      'UNDERSTANDING_WRITING_FAILED',
      true,
    );

    /** @example expect(error.operation).toBe('writing'); */
    expect(error).toMatchObject({
      code: 'UNDERSTANDING_WRITING_FAILED',
      operation: 'writing',
    });
  });
});
