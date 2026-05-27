import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { formatErrorForState } from './formatErrorForState';

describe('formatErrorForState', () => {
  describe('input normalization', () => {
    it('handles ChatCompletionErrorPayload — extracts errorType and message', () => {
      const result = formatErrorForState({
        error: { detail: 'Unauthorized' },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        message: 'Invalid API key',
        provider: 'openai',
      });

      expect(result.type).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      expect(result.message).toBe('Invalid API key');
      expect(result.body).toEqual({ detail: 'Unauthorized' });
    });

    it('wraps standard Error as InternalServerError', () => {
      const result = formatErrorForState(new TypeError('boom'));

      expect(result.type).toBe(ChatErrorType.InternalServerError);
      expect(result.message).toBe('boom');
      expect(result.body).toEqual({ name: 'TypeError' });
    });

    it('falls back to AgentRuntimeError for unknown thrown values', () => {
      const result = formatErrorForState('plain string failure');

      expect(result.type).toBe(AgentRuntimeErrorType.AgentRuntimeError);
      expect(result.message).toBe('plain string failure');
    });
  });

  describe('ERROR_CODE_SPECS enrichment', () => {
    it('attaches classification fields when the errorType is registered in the spec table', () => {
      const result = formatErrorForState({
        errorType: AgentRuntimeErrorType.InsufficientQuota,
        message: 'balance exhausted',
      });

      expect(result).toMatchObject({
        attribution: 'user',
        category: 'quota',
        countAsFailure: false,
        httpStatus: 429,
        numericId: 2001,
        retryable: false,
        severity: 'warning',
      });
    });

    it('marks provider-side rate limits as retryable with provider attribution', () => {
      const result = formatErrorForState({
        errorType: AgentRuntimeErrorType.RateLimitExceeded,
        message: 'RPM exceeded',
      });

      expect(result.attribution).toBe('provider');
      expect(result.category).toBe('capacity');
      expect(result.retryable).toBe(true);
      expect(result.countAsFailure).toBe(false);
    });

    it('resolves the QuotaLimitReached → RateLimitExceeded alias', () => {
      const result = formatErrorForState({
        errorType: AgentRuntimeErrorType.QuotaLimitReached,
        message: 'rate limited',
      });

      expect(result.type).toBe(AgentRuntimeErrorType.QuotaLimitReached);
      expect(result.attribution).toBe('provider');
      expect(result.category).toBe('capacity');
    });

    it('leaves classification fields unset for codes outside the spec table', () => {
      const result = formatErrorForState(new Error('infra blew up'));

      expect(result.type).toBe(ChatErrorType.InternalServerError);
      expect(result.attribution).toBeUndefined();
      expect(result.category).toBeUndefined();
      expect(result.severity).toBeUndefined();
      expect(result.httpStatus).toBeUndefined();
      expect(result.retryable).toBeUndefined();
      expect(result.countAsFailure).toBeUndefined();
      expect(result.numericId).toBeUndefined();
    });
  });
});
