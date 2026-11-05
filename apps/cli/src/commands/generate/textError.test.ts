import { describe, expect, it } from 'vitest';

import { formatTextGenerationError } from './textError';

describe('formatTextGenerationError', () => {
  it('explains an empty completion stopped by the output-token limit', () => {
    const text = JSON.stringify({
      body: { finishReason: 'MAX_TOKENS', provider: 'lobehub' },
      errorType: 'ModelEmptyCompletion',
    });

    expect(formatTextGenerationError(471, text, { maxTokens: 32 })).toBe(
      'Text generation failed: ModelEmptyCompletion (HTTP 471). The model returned no visible output. It reached the output-token limit (--max-tokens 32) before writing any text; reasoning can use up the budget. Raise --max-tokens and retry.',
    );
  });

  it('reads the finish reason from serialized diagnostics', () => {
    const text = JSON.stringify({
      body: { diagnostics: { finishReason: 'length' }, provider: 'openai' },
      errorType: 'ModelEmptyCompletion',
    });

    expect(formatTextGenerationError(471, text)).toBe(
      'Text generation failed: ModelEmptyCompletion (HTTP 471). The model returned no visible output. It reached the output-token limit before writing any text; reasoning can use up the budget. Raise --max-tokens and retry.',
    );
  });

  it('hints at --max-tokens for an empty completion without a known finish reason', () => {
    const text = JSON.stringify({ body: {}, errorType: 'ModelEmptyCompletion' });

    expect(formatTextGenerationError(471, text, { maxTokens: 16 })).toContain(
      'If reasoning used up --max-tokens 16, raise it and retry.',
    );
    expect(formatTextGenerationError(471, text)).toBe(
      'Text generation failed: ModelEmptyCompletion (HTTP 471). The model returned no visible output.',
    );
  });

  it('prints the message and trace id of other structured errors', () => {
    const text = JSON.stringify({
      body: { error: { message: 'upstream failure' }, traceId: 'log-1' },
      errorType: 'ProviderBizError',
    });

    expect(formatTextGenerationError(500, text)).toBe(
      'Text generation failed: ProviderBizError (HTTP 500). upstream failure Trace ID: log-1',
    );
  });

  it('summarizes an HTML error page instead of dumping it', () => {
    const html = '<!DOCTYPE html><html><head><title>500</title></head><body>...</body></html>';

    expect(formatTextGenerationError(500, html)).toBe(
      'Text generation failed: HTTP 500. The server returned an HTML error page instead of an error message.',
    );
  });

  it('truncates other raw bodies', () => {
    expect(formatTextGenerationError(502, `${'x'.repeat(300)}`)).toBe(
      `Text generation failed: HTTP 502 ${'x'.repeat(200)}`,
    );
    expect(formatTextGenerationError(500, 'Internal error')).toBe(
      'Text generation failed: HTTP 500 Internal error',
    );
  });
});
