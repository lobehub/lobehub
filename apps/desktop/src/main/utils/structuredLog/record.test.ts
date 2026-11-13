import { describe, expect, it } from 'vitest';

import {
  createLogRecord,
  MAX_RECORD_BYTES,
  serializeLogRecord,
  splitConsoleTag,
  toLogValue,
} from './record';

const now = new Date('2026-11-12T10:00:00.123Z');

describe('createLogRecord', () => {
  it('extracts the operation and topic ids a server trace is keyed by', () => {
    const operationId = 'op_1762900000000_agt_abc123_tpc_xyz789_Ab-d_12x';
    const record = createLogRecord({
      args: [{ operationId }],
      level: 'info',
      message: 'gateway connected',
      now,
      ns: 'Gateway',
      pid: 42,
      process: 'main',
    });

    expect(record).toEqual({
      args: [{ operationId }],
      level: 'info',
      msg: 'gateway connected',
      ns: 'Gateway',
      operationId,
      pid: 42,
      process: 'main',
      topicId: 'tpc_xyz789',
      ts: '2026-11-12T10:00:00.123Z',
    });
  });

  it('formats printf-style messages and drops the consumed arguments', () => {
    const record = createLogRecord({
      args: ['main', 12],
      level: 'debug',
      message: 'loaded %s in %dms',
      now,
      process: 'main',
    });

    expect(record.msg).toBe('loaded main in 12ms');
    expect(record.args).toBeUndefined();
  });

  it('keeps a non-string message as the first argument', () => {
    const record = createLogRecord({
      level: 'error',
      message: new Error('boom'),
      now,
      process: 'main',
    });

    expect(record.msg).toBe('');
    expect(record.args?.[0]).toMatchObject({ message: 'boom', name: 'Error' });
  });

  it('redacts bearer tokens, JWTs and secret-named fields', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    const record = createLogRecord({
      args: [{ accessToken: 'plain', headers: { authorization: 'x' }, note: jwt }],
      level: 'info',
      message: 'Authorization: Bearer abc.def-123',
      now,
      process: 'main',
    });

    expect(record.msg).toBe('Authorization: [REDACTED]');
    expect(record.args).toEqual([
      {
        accessToken: '[REDACTED]',
        headers: { authorization: '[REDACTED]' },
        note: '[REDACTED_JWT]',
      },
    ]);
  });
});

describe('createLogRecord secret redaction in text', () => {
  it('redacts secret-named fields that a format specifier prints', () => {
    const record = createLogRecord({
      args: [{ password: 'hunter2-fake', user: 'a' }],
      level: 'debug',
      message: 'login payload %O',
      now,
      process: 'main',
    });

    expect(record.msg).not.toContain('hunter2-fake');
    expect(record.msg).toContain('[REDACTED]');
  });

  it('redacts cookies, stringified secret fields and credential query parameters', () => {
    const message = [
      'Cookie: session=fake-session; theme=dark',
      JSON.stringify({ apiKey: 'fake-api-key-value', host: 'example.com' }),
      'GET https://example.com/v1?key=AIzaFakeKey&access_token=fake-token&page=2',
    ].join(' | ');
    const record = createLogRecord({ level: 'info', message, now, process: 'main' });

    for (const secret of ['fake-session', 'fake-api-key-value', 'AIzaFakeKey', 'fake-token'])
      expect(record.msg).not.toContain(secret);
    expect(record.msg).toContain('"host":"example.com"');
    expect(record.msg).toContain('page=2');
  });

  it('redacts URL userinfo but keeps the host', () => {
    const record = createLogRecord({
      level: 'debug',
      message: 'Testing proxy with URL: http://alice:my-proxy-pass@proxy.example.com:8080',
      now,
      process: 'main',
    });

    expect(record.msg).toBe('Testing proxy with URL: http://[REDACTED]@proxy.example.com:8080');
    expect(
      createLogRecord({
        level: 'info',
        message: 'mailto x@y.com https://example.com/a@b',
        now,
        process: 'main',
      }).msg,
    ).toBe('mailto x@y.com https://example.com/a@b');
  });

  it('redacts numeric, uuid-like and quoted secret values', () => {
    const record = createLogRecord({
      level: 'debug',
      message:
        "password=123456 access_token=12345678-abcd-4321-8abc-123456789abc secret='FAKE PASS' token: 987654",
      now,
      process: 'main',
    });

    for (const secret of ['123456', '12345678-abcd', 'FAKE PASS', '987654'])
      expect(record.msg).not.toContain(secret);
  });

  it('keeps token counts and flags readable', () => {
    const record = createLogRecord({
      level: 'info',
      message: 'usage inputTokens: 532, outputTokens=40, tokenExpired: false',
      now,
      process: 'main',
    });

    expect(record.msg).toBe('usage inputTokens: 532, outputTokens=40, tokenExpired: false');
  });
});

describe('toLogValue', () => {
  it('survives circular references and bounds depth', () => {
    const value: Record<string, unknown> = { a: { b: { c: { d: { e: 1 } } } } };
    value.self = value;

    expect(toLogValue(value)).toEqual({ a: { b: { c: { d: '[Object]' } } }, self: '[Circular]' });
  });
});

describe('serializeLogRecord', () => {
  it('drops oversized args but keeps the message', () => {
    const record = createLogRecord({
      args: [Array.from({ length: 40 }, () => 'x'.repeat(3000))],
      level: 'info',
      message: 'huge payload',
      now,
      process: 'main',
    });
    const line = serializeLogRecord(record);

    expect(line.length).toBeLessThan(MAX_RECORD_BYTES);
    expect(JSON.parse(line)).toMatchObject({ msg: 'huge payload' });
    expect(JSON.parse(line).args[0]).toMatch(/^\[args dropped/);
  });
});

describe('splitConsoleTag', () => {
  it('turns a leading [Tag] into the namespace', () => {
    expect(splitConsoleTag('[Menu] Opening logs')).toEqual({ message: 'Opening logs', ns: 'Menu' });
    expect(splitConsoleTag('plain line')).toEqual({ message: 'plain line' });
  });
});
