import { describe, expect, it } from 'vitest';

import { classifyLLMError } from '../llmErrorClassification';

describe('classifyLLMError', () => {
  it('should classify rate limit errors as retry', () => {
    expect(
      classifyLLMError({ errorType: 'QuotaLimitReached', message: '429 rate limit' }).kind,
    ).toBe('retry');
  });

  it('should classify invalid api key errors as stop', () => {
    expect(
      classifyLLMError({ errorType: 'InvalidProviderAPIKey', message: '401 unauthorized' }).kind,
    ).toBe('stop');
  });

  it('should classify context window errors as stop', () => {
    expect(
      classifyLLMError({ errorType: 'ExceededContextWindow', message: 'maximum context length' })
        .kind,
    ).toBe('stop');
  });

  it('should classify ProviderBizError invalid_request errors as stop', () => {
    expect(
      classifyLLMError({
        error: {
          error: {
            message: 'tools.0.custom.input_schema: Field required',
            type: 'invalid_request_error',
          },
          errorType: 'ProviderBizError',
        },
        errorType: 'ProviderBizError',
      }).kind,
    ).toBe('stop');
  });

  it('should keep ProviderBizError rate limit errors as retry', () => {
    expect(
      classifyLLMError({
        error: { message: '429 rate limit exceeded' },
        errorType: 'ProviderBizError',
      }).kind,
    ).toBe('retry');
  });

  it('should default unknown errors to retry', () => {
    expect(classifyLLMError(new Error('unexpected upstream issue')).kind).toBe('retry');
  });

  describe('non-string code / errorType defensive handling', () => {
    // Regression: real-world provider errors sometimes carry numeric `code`
    // (HTTP status) or a structured object in the error fields. Earlier versions
    // called `.trim()` on these and threw TypeError, which masked the original
    // provider error behind "e.trim is not a function".

    it('does not throw when error.code is a number', () => {
      const result = classifyLLMError({ code: 429, message: 'rate limit' });
      expect(result.message).toBe('rate limit');
      // Classifier should still land on a valid kind, not crash.
      expect(['retry', 'stop']).toContain(result.kind);
    });

    it('does not throw when errorType is an object', () => {
      const result = classifyLLMError({
        errorType: { nested: 'structured error' },
        message: 'upstream returned structured type',
      });
      expect(result.message).toBe('upstream returned structured type');
      expect(['retry', 'stop']).toContain(result.kind);
    });

    it('does not throw when nested error.code is a number (OpenAI SDK shape)', () => {
      const result = classifyLLMError({
        error: { error: { code: 402, message: 'payment required' } },
        errorType: 'ProviderBizError',
      });
      expect(result.message).toBe('payment required');
      expect(['retry', 'stop']).toContain(result.kind);
    });

    // Regression: some third-party proxies surface HTTP status ONLY as a
    // numeric `code` (no `status`/`statusCode`, no status digits in the
    // message). Previously these fell through to `retry`, causing wasteful
    // retry loops on permanent auth/permission failures.

    it('treats numeric code=401 as stop when no status field is present', () => {
      const result = classifyLLMError({ code: 401, message: 'upstream refused' });
      expect(result.kind).toBe('stop');
    });

    it('treats numeric code=403 as stop when no status field is present', () => {
      const result = classifyLLMError({ code: 403, message: 'upstream refused' });
      expect(result.kind).toBe('stop');
    });

    it('treats numeric code=429 as retry when no status field is present', () => {
      const result = classifyLLMError({ code: 429, message: 'upstream refused' });
      expect(result.kind).toBe('retry');
    });

    it('treats nested numeric code as stop (proxy-wrapped auth failure)', () => {
      const result = classifyLLMError({
        error: { error: { code: 401, message: 'proxy refused upstream' } },
      });
      expect(result.kind).toBe('stop');
    });

    it('prefers explicit status over numeric code fallback', () => {
      // status says 500 (retry), code says 401 (stop) — status wins.
      const result = classifyLLMError({ code: 401, message: 'oops', status: 500 });
      expect(result.kind).toBe('retry');
    });

    it('preserves the original error message when normalizeSignal itself would throw', () => {
      // Force a normalizeSignal crash by making `.toLowerCase()` blow up on a
      // non-string message (via a Proxy that throws on Symbol.toPrimitive).
      const hostile = new Proxy(
        {},
        {
          get: () => {
            throw new Error('property access explodes');
          },
        },
      );
      const result = classifyLLMError(hostile);
      // Falls back to 'stop' when classifier throws; message is best-effort.
      expect(result.kind).toBe('stop');
      expect(typeof result.message).toBe('string');
    });
  });
});
