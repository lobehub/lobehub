import { ModelEmptyError } from '@lobechat/model-runtime';
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
      expect(result.body).toEqual({
        detail: 'Unauthorized',
        message: 'Invalid API key',
        provider: 'openai',
      });
    });

    it('preserves top-level context from ChatCompletionErrorPayload', () => {
      const budget = { required: 12 };

      const result = formatErrorForState({
        budget,
        error: { message: 'Budget exceeded' },
        errorType: ChatErrorType.FreePlanLimit,
        provider: 'lobehub',
      });

      expect(result).toMatchObject({
        attribution: 'user',
        body: {
          budget,
          message: 'Budget exceeded',
          provider: 'lobehub',
        },
        category: 'quota',
        httpStatus: 402,
        message: 'Budget exceeded',
        type: ChatErrorType.FreePlanLimit,
      });
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
        isFallback: false,
        numericId: 2001,
        retryable: false,
        severity: 'warning',
      });
    });

    it('enriches a thrown ModelEmptyError into a readable non-retryable terminal error', () => {
      const result = formatErrorForState(
        new ModelEmptyError(undefined, {
          attempt: 1,
          cost: 5.980_015,
          maxAttempts: 1,
          outputTokens: 25_617,
        }),
      );

      // The `errorType` field must win over the generic Error → InternalServerError
      // path so the terminal state is classified and dashboard-visible instead of
      // a silent `done`.
      expect(result.type).toBe(AgentRuntimeErrorType.ModelEmptyCompletion);
      expect(result.category).toBe('provider');
      expect(result.attribution).toBe('provider');
      expect(result.retryable).toBe(false);
      expect(result.countAsFailure).toBe(true);
      expect(result.numericId).toBe(8014);
      expect(result.message).toContain('empty completion');
      expect(result.body).toMatchObject({
        diagnostics: {
          attempt: 1,
          cost: 5.980_015,
          maxAttempts: 1,
          outputTokens: 25_617,
        },
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

    it('is idempotent on an already-normalized ChatMessageError', () => {
      const once = formatErrorForState({
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        message: 'bad key',
      });
      const twice = formatErrorForState(once);

      // Re-running the helper must not collapse to AgentRuntimeError or strip
      // classification — both are real risks if the early-return branch is
      // missing, because the success-path inner-step write can run through
      // here a second time when the outer service touches state.error again.
      expect(twice.type).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      expect(twice.attribution).toBe('user');
      expect(twice.category).toBe('auth');
      expect(twice.message).toBe('bad key');
    });

    it('enriches a partial ChatMessageError that only carries type + message', () => {
      const result = formatErrorForState({
        message: 'balance exhausted',
        type: AgentRuntimeErrorType.InsufficientQuota,
      });

      expect(result.attribution).toBe('user');
      expect(result.category).toBe('quota');
      expect(result.httpStatus).toBe(429);
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

    it('classifies a raw Drizzle "Failed query" Error via its message instead of a bare 500', () => {
      const result = formatErrorForState(new Error('Failed query: rollback\nparams: '));

      expect(result.type).toBe(AgentRuntimeErrorType.DatabasePersistError);
      expect(result.numericId).toBe(7004);
      expect(result.attribution).toBe('harness');
    });

    it('unwraps PG diagnostics from a Drizzle "Failed query" cause for final state errors', () => {
      const error = new Error('Failed query: begin \nparams: ');
      (error as any).cause = {
        code: 'XX000',
        message:
          'Failed to acquire permit to connect to the database. Too many database connection attempts are currently ongoing.',
        severity: 'ERROR',
      };

      const result = formatErrorForState(error);

      expect(result.type).toBe('pg_XX000');
      expect(result.message).toBe(
        'PG XX000 · ERROR · Failed to acquire permit to connect to the database. Too many database connection attempts are currently ongoing.',
      );
      expect(result.attribution).toBe('harness');
      expect(result.category).toBe('stream');
      expect(result.countAsFailure).toBe(true);
      expect(result.body).toMatchObject({
        pg: {
          code: 'XX000',
          message:
            'Failed to acquire permit to connect to the database. Too many database connection attempts are currently ongoing.',
          severity: 'ERROR',
        },
        wrappedMessage: 'Failed query: begin \nparams: ',
      });
    });
  });

  describe('ProviderBizError refinement', () => {
    it('reclassifies a 429 ProviderBizError into RateLimitExceeded (retryable, not a failure)', () => {
      const result = formatErrorForState({
        error: { status: 429 },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: '429 status code (no body)',
      });

      expect(result.type).toBe(AgentRuntimeErrorType.RateLimitExceeded);
      expect(result.numericId).toBe(3001);
      expect(result.retryable).toBe(true);
      expect(result.countAsFailure).toBe(false);
      // Original message is preserved for debugging.
      expect(result.message).toBe('429 status code (no body)');
    });

    it('reclassifies gateway HTML into UpstreamGatewayError (E8011)', () => {
      const result = formatErrorForState({
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: '<center>openresty</center>',
      });

      expect(result.type).toBe(AgentRuntimeErrorType.UpstreamGatewayError);
      expect(result.numericId).toBe(8011);
      expect(result.retryable).toBe(true);
    });

    it('uses the HTTP-status fallback for an opaque 402 body', () => {
      const result = formatErrorForState({
        error: { status: 402 },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: 'opaque upstream message',
      });

      expect(result.type).toBe(AgentRuntimeErrorType.InsufficientQuota);
      expect(result.category).toBe('quota');
    });

    it('keeps payload.error available when _responseBody is present', () => {
      const result = formatErrorForState({
        _responseBody: { provider: 'lobehub' },
        error: { status: 402 },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: 'opaque upstream message',
      });

      expect(result).toMatchObject({
        body: {
          error: { status: 402 },
          message: 'opaque upstream message',
          provider: 'lobehub',
        },
        category: 'quota',
        type: AgentRuntimeErrorType.InsufficientQuota,
      });
    });

    it('merges payload status into an existing _responseBody error object', () => {
      const result = formatErrorForState({
        _responseBody: { error: { message: 'Payment required' }, provider: 'lobehub' },
        error: { status: 402 },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: 'opaque upstream message',
      });

      expect(result).toMatchObject({
        body: {
          error: { message: 'Payment required', status: 402 },
          provider: 'lobehub',
        },
        category: 'quota',
        type: AgentRuntimeErrorType.InsufficientQuota,
      });
    });

    it('keeps a genuine residual as ProviderBizError (E8002)', () => {
      const result = formatErrorForState({
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: 'Upstream request failed',
      });

      expect(result.type).toBe(AgentRuntimeErrorType.ProviderBizError);
      expect(result.numericId).toBe(8002);
      // ProviderBizError is a catch-all — flagged so monitoring can track
      // how much volume still lands in fallback buckets.
      expect(result.isFallback).toBe(true);
    });
  });

  // The heterogeneous CLI agents (Claude Code / Codex) used to normalize their
  // wire `error` event data through a bespoke `toChatMessageError`. That helper is
  // retired — these inputs now flow through this single canonical formatter so a
  // hetero error is classified identically to an in-process one. These guard the
  // shapes that bespoke helper handled (and the '[object Object]' bug it avoided).
  describe('heterogeneous CLI error normalization', () => {
    it('keeps a typed wire error `{ message, type, code }` as AgentRuntimeError, message intact', () => {
      // The real CC/Codex wire shape carries a `type` (→ already-normalized path)
      // plus a `code` (e.g. AuthRequired) used elsewhere for echo suppression.
      const result = formatErrorForState({
        code: 'AuthRequired',
        message: 'cli adapter failure xyz',
        type: 'AgentRuntimeError',
      });

      expect(result.type).toBe(AgentRuntimeErrorType.AgentRuntimeError);
      expect(result.message).toBe('cli adapter failure xyz');
    });

    it('extracts `.message` from a typeless `{ message, stderr }` body instead of stringifying it', () => {
      // Regression: stringifying the object yielded the message "[object Object]".
      const result = formatErrorForState({ message: 'agent process exited', stderr: 'boom' });

      expect(result.type).toBe(AgentRuntimeErrorType.AgentRuntimeError);
      expect(result.message).toBe('agent process exited');
      expect(result.message).not.toBe('[object Object]');
      // The raw body is preserved so downstream keeps the stderr / code context.
      expect(result.body).toMatchObject({ message: 'agent process exited', stderr: 'boom' });
    });

    it('falls back to a generic message for a typeless body with no message', () => {
      const result = formatErrorForState({ code: 'Unknown' });

      expect(result.type).toBe(AgentRuntimeErrorType.AgentRuntimeError);
      expect(result.message).toBe('Agent runtime error');
      expect(result.body).toMatchObject({ code: 'Unknown' });
    });

    it('wraps a non-string primitive as a generic AgentRuntimeError', () => {
      const result = formatErrorForState(42);

      expect(result.type).toBe(AgentRuntimeErrorType.AgentRuntimeError);
      expect(result.message).toBe('Agent runtime error');
      expect(result.body).toEqual({ message: 'Agent runtime error' });
    });

    it('wraps a raw string in a `{ message }` body', () => {
      const result = formatErrorForState('plain string failure');

      expect(result.type).toBe(AgentRuntimeErrorType.AgentRuntimeError);
      expect(result.message).toBe('plain string failure');
      expect(result.body).toEqual({ message: 'plain string failure' });
    });
  });
});
