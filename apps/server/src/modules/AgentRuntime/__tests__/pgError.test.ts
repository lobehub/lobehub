import { describe, expect, it } from 'vitest';

import { formatPgError, pgErrorType, unwrapPgError } from '../pgError';

describe('unwrapPgError', () => {
  it('extracts fields from a top-level pg driver error', () => {
    const err: any = {
      code: '22021',
      column: 'state',
      detail: 'invalid byte sequence',
      message: 'invalid byte sequence for encoding "UTF8": 0xed 0xa0 0x9f',
      severity: 'ERROR',
      table: 'message_plugins',
    };
    expect(unwrapPgError(err)).toEqual({
      code: '22021',
      column: 'state',
      constraint: undefined,
      detail: 'invalid byte sequence',
      message: 'invalid byte sequence for encoding "UTF8": 0xed 0xa0 0x9f',
      severity: 'ERROR',
      table: 'message_plugins',
    });
  });

  it('walks .cause for the drizzle + postgres-js shape', () => {
    const outer: any = new Error('Failed query: insert into "message_plugins" ...');
    outer.cause = { code: '23505', message: 'duplicate key', severity: 'ERROR' };
    expect(unwrapPgError(outer)).toMatchObject({
      code: '23505',
      message: 'duplicate key',
      severity: 'ERROR',
    });
  });

  it('walks nested .cause layers (double-wrapped transaction error)', () => {
    const inner: any = { code: '54000', message: 'row is too big', severity: 'ERROR' };
    const middle: any = new Error('transaction failed');
    middle.cause = inner;
    const outer: any = new Error('Failed query: ...');
    outer.cause = middle;
    expect(unwrapPgError(outer)?.code).toBe('54000');
  });

  it('accepts constraint_name / table_name aliases from pg driver', () => {
    const err: any = {
      code: '23503',
      constraint_name: 'messages_parent_id_messages_id_fk',
      message: 'fk violation',
      severity: 'ERROR',
      table_name: 'messages',
    };
    expect(unwrapPgError(err)).toMatchObject({
      constraint: 'messages_parent_id_messages_id_fk',
      table: 'messages',
    });
  });

  it('rejects objects with a code but no pg severity (not a pg error)', () => {
    // Node-style errors and fetch failures often have a `code` like "ENOTFOUND"
    // but no `severity` — must not be mistaken for a pg error.
    const err: any = new Error('getaddrinfo ENOTFOUND db.example');
    (err as any).code = 'ENOTFOUND';
    expect(unwrapPgError(err)).toBeNull();
  });

  it('rejects objects with an unrecognized severity', () => {
    const err: any = { code: '22021', message: 'x', severity: 'TOTALLY_FAKE' };
    expect(unwrapPgError(err)).toBeNull();
  });

  it('handles null / non-object inputs safely', () => {
    expect(unwrapPgError(null)).toBeNull();
    expect(unwrapPgError(undefined)).toBeNull();
    expect(unwrapPgError('string-error')).toBeNull();
    expect(unwrapPgError(42)).toBeNull();
  });

  it('stops walking at depth 5 to avoid cycles', () => {
    const a: any = new Error('a');
    const b: any = new Error('b');
    a.cause = b;
    b.cause = a;
    // Should not throw / hang — just returns null because no pg error in chain.
    expect(unwrapPgError(a)).toBeNull();
  });
});

describe('formatPgError', () => {
  it('renders a single-line summary with code + severity + message', () => {
    const out = formatPgError({
      code: '22021',
      column: 'state',
      message: 'invalid byte sequence',
      severity: 'ERROR',
      table: 'message_plugins',
    });
    expect(out).toBe(
      'PG 22021 · ERROR · invalid byte sequence · table=message_plugins · column=state',
    );
  });

  it('omits empty fields', () => {
    const out = formatPgError({ code: '23505', message: 'dup', severity: 'ERROR' });
    expect(out).toBe('PG 23505 · ERROR · dup');
  });
});

describe('pgErrorType', () => {
  it('derives a stable bucket key from the pg code', () => {
    expect(pgErrorType({ code: '22021', message: 'x' })).toBe('pg_22021');
  });

  it('falls back to pg_unknown when code is missing', () => {
    expect(pgErrorType({ message: 'x' })).toBe('pg_unknown');
  });
});
