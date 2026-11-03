import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { formatDocumentCharLimitMessage } from '@/server/services/document/writeLimit';

import { classifyToolError, getToolAccessDeniedError } from '../errorClassification';

describe('classifyToolError', () => {
  it('should classify rate limit as retry', () => {
    const result = classifyToolError({ code: 'TOO_MANY_REQUESTS', message: 'rate limit' });

    expect(result.kind).toBe('retry');
  });

  it('should classify forbidden as stop', () => {
    const result = classifyToolError({ message: 'request failed 403 forbidden' });

    expect(result.kind).toBe('stop');
  });

  it('should classify invalid schema as replan', () => {
    const result = classifyToolError(new Error('invalid schema for tool arguments'));

    expect(result.kind).toBe('replan');
  });

  it('classifies a refused document write as replan and keeps the numbers', () => {
    const error = new TRPCError({
      cause: { data: { actual: 123456, code: 'DocumentCharLimitExceeded', limit: 100000 } },
      code: 'BAD_REQUEST',
      message: formatDocumentCharLimitMessage({ actual: 123456, limit: 100000, plan: 'free' }),
    });

    const result = classifyToolError(error);

    expect(result.kind).toBe('replan');
    expect(result.message).toContain('123456');
    expect(result.message).toContain('100000');
    expect(result.message).toContain('split the content');
  });

  it('reads the code of an error a builtin runtime wrapped as its body', () => {
    const body = new TRPCError({
      code: 'BAD_REQUEST',
      message: formatDocumentCharLimitMessage({ actual: 123456, limit: 100000 }),
    });

    const result = classifyToolError({ body, message: body.message, type: 'PluginServerError' });

    expect(result.kind).toBe('replan');
  });

  it('should default unknown errors to stop', () => {
    const result = classifyToolError(new Error('unexpected issue'));

    expect(result.kind).toBe('stop');
  });
});

describe('getToolAccessDeniedError', () => {
  it('handles a thrown string without losing its message', () => {
    expect(getToolAccessDeniedError('Forbidden', '')).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
  });

  it('keeps documented upstream guidance without publishing the raw response body', () => {
    const error = Object.assign(new Error('Access denied'), {
      code: 'PERMISSION_DENIED',
      errorBody: {
        error: { doc_url: 'https://example.com/help', hint: 'Ask an administrator.' },
        internal: 'private response detail',
      },
      status: 403,
    });

    expect(getToolAccessDeniedError(error, error.message)).toEqual({
      code: 'PERMISSION_DENIED',
      doc_url: 'https://example.com/help',
      hint: 'Ask an administrator.',
      kind: 'stop',
      message: 'Access denied',
      status: 403,
    });
  });

  it('accepts numeric HTTP error codes without throwing', () => {
    expect(getToolAccessDeniedError({ code: 403, message: 'Request blocked' }, '')).toMatchObject({
      code: 'FORBIDDEN',
      kind: 'stop',
    });
  });

  it.each([
    [undefined, 'curl: (22) The requested URL returned error: 403'],
    [new Error('AssertionError: expected 200 but got 403'), ''],
  ])('does not infer a platform refusal from an HTTP status in tool output', (error, content) => {
    expect(getToolAccessDeniedError(error, content)).toBeUndefined();
  });

  it.each([
    { code: 'BAD_REQUEST', message: 'The word forbidden is not a supported option' },
    { message: 'ENOENT: /tmp/forbidden.txt' },
    { message: 'Network error', status: 503 },
    { code: 'NOT_IMPLEMENTED', message: 'Unsupported tool' },
  ])('does not invent a refusal from an unrelated error: $message', (error) => {
    expect(getToolAccessDeniedError(error, error.message)).toBeUndefined();
  });
});
