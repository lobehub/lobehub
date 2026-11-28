import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { isRetryableError } from './retry';

const serverError = (code: string) =>
  Object.assign(new pg.DatabaseError('x', 0, 'error'), { code });

describe('isRetryableError', () => {
  it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'])('retries Node error %s', (code) => {
    expect(isRetryableError(Object.assign(new Error(code), { code }))).toBe(true);
  });

  it('retries an error without a code, such as a client query timeout', () => {
    expect(isRetryableError(new Error('Query read timeout'))).toBe(true);
  });

  it('retries a PostgreSQL connection exception', () => {
    expect(isRetryableError(serverError('08006'))).toBe(true);
  });

  it.each(['23505', '57014', '42P01'])('does not retry SQLSTATE %s', (code) => {
    expect(isRetryableError(serverError(code))).toBe(false);
  });
});
