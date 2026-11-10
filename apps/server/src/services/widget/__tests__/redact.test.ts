import { describe, expect, it } from 'vitest';

import { redactSecrets, sanitizeStream, truncateStream } from '../redact';

describe('redactSecrets', () => {
  it('replaces every injected secret value with its variable name', () => {
    const text = 'token=abc123secret and again abc123secret';

    expect(redactSecrets(text, { API_TOKEN: 'abc123secret' })).toBe(
      'token=[REDACTED:API_TOKEN] and again [REDACTED:API_TOKEN]',
    );
  });

  it('matches the longest secret first', () => {
    expect(redactSecrets('value: abcdef-long', { A: 'abcdef', B: 'abcdef-long' })).toBe(
      'value: [REDACTED:B]',
    );
  });

  it('ignores very short values that would shred normal text', () => {
    expect(redactSecrets('status: ok', { FLAG: 'ok' })).toBe('status: ok');
  });

  it('redacts well-known token shapes it was not told about', () => {
    const text = [
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'sk-proj-abcdefghijklmnopqrstuvwx',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    ].join('\n');

    expect(redactSecrets(text)).toBe(
      ['[REDACTED]', '[REDACTED]', 'Authorization: Bearer [REDACTED]'].join('\n'),
    );
  });
});

describe('truncateStream', () => {
  it('keeps short streams untouched', () => {
    expect(truncateStream('hello', 10)).toBe('hello');
  });

  it('cuts long streams to the limit with a marker', () => {
    const result = truncateStream('x'.repeat(100), 40);

    expect(result.length).toBe(40);
    expect(result.endsWith('…[truncated]')).toBe(true);
  });
});

describe('sanitizeStream', () => {
  it('redacts before truncating so a secret at the cut is never half-kept', () => {
    const secret = 'supersecretvalue';
    const text = `${'a'.repeat(20)}${secret}`;

    expect(sanitizeStream(text, { S: secret })).not.toContain('supersecret');
  });
});
