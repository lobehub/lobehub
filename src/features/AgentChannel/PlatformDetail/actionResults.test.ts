import { describe, expect, it } from 'vitest';

import { keepPendingConnectResult, toTestResult } from './actionResults';

const hintForCode = (code: string) => `hint:${code}`;

const RAW_MESSAGE = 'credentials: Failed to authenticate with Feishu API: Lark auth error: 10003';

describe('toTestResult', () => {
  it('maps a passing check to a success banner', () => {
    expect(toTestResult({ valid: true }, hintForCode)).toEqual({ type: 'success' });
  });

  it('explains a recognized failure with a hint and keeps the raw message', () => {
    expect(
      toTestResult(
        { errors: [{ code: 'invalid_credentials' }], message: RAW_MESSAGE, valid: false },
        hintForCode,
      ),
    ).toEqual({
      errorDetail: RAW_MESSAGE,
      hint: 'hint:invalid_credentials',
      type: 'error',
    });
  });

  it('uses the first error that carries a code', () => {
    const result = toTestResult(
      { errors: [{}, { code: 'rate_limited' }], message: RAW_MESSAGE, valid: false },
      hintForCode,
    );

    expect(result.hint).toBe('hint:rate_limited');
  });

  it('shows only the raw message when the failure is not classified', () => {
    expect(toTestResult({ errors: [{}], message: RAW_MESSAGE, valid: false }, hintForCode)).toEqual(
      {
        errorDetail: RAW_MESSAGE,
        hint: undefined,
        type: 'error',
      },
    );
  });

  it('drops an empty hint for a code without a translation', () => {
    const result = toTestResult(
      { errors: [{ code: 'unknown_code' }], message: RAW_MESSAGE, valid: false },
      () => '',
    );

    expect(result.hint).toBeUndefined();
  });
});

describe('keepPendingConnectResult', () => {
  it('keeps an in-progress connect notice', () => {
    const pending = { title: 'queued', type: 'info' as const };

    expect(keepPendingConnectResult(pending)).toBe(pending);
  });

  it('drops a settled connect banner', () => {
    expect(keepPendingConnectResult({ type: 'success' })).toBeUndefined();
    expect(keepPendingConnectResult({ errorDetail: 'boom', type: 'error' })).toBeUndefined();
    expect(keepPendingConnectResult(undefined)).toBeUndefined();
  });
});
