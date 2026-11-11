import { describe, expect, it } from 'vitest';

import { applyMatches, createRedactor, redactChunks, RedactionLog, redactText } from './redact';

const redactor = (env: NodeJS.ProcessEnv = {}, custom?: string[]) =>
  createRedactor({ custom, env, homeDir: '/Users/alice' });

const redact = (text: string, env?: NodeJS.ProcessEnv, custom?: string[]) => {
  const log = new RedactionLog();
  return { log: log.toJSON.bind(log), text: redactText(redactor(env, custom), log, text) };
};

describe('createRedactor', () => {
  it('masks the values of secret-looking environment variables wherever they appear', () => {
    const { log, text } = redact('key is s3cr3t-value, again s3cr3t-value', {
      LODY_SESSION_ID: 'abc123def456',
      MY_API_KEY: 's3cr3t-value',
      NEXTAUTH_URL: 'http://localhost:3000',
    });
    expect(text).toBe('key is [REDACTED:MY_API_KEY], again [REDACTED:MY_API_KEY]');
    expect(log()).toEqual([{ count: 2, rule: 'env-secret' }]);
  });

  it('leaves ids and urls that only look sensitive by name', () => {
    expect(
      redact('session abc123def456 at http://localhost:3000', {
        LODY_SESSION_ID: 'abc123def456',
        NEXTAUTH_URL: 'http://localhost:3000',
      }).text,
    ).toBe('session abc123def456 at http://localhost:3000');
  });

  it.each([
    ['an OpenAI key', 'use sk-proj-abcdefghijklmnopqrstuv', 'use [REDACTED:token]'],
    ['a GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz0123', '[REDACTED:token]'],
    ['an AWS key id', 'AKIAABCDEFGHIJKLMNOP', '[REDACTED:token]'],
    ['a bearer header', 'Authorization: Bearer abc.def.ghi123', 'Authorization: Bearer [REDACTED]'],
    ['URL credentials', 'postgres://user:pa55@db:5432/x', 'postgres://[REDACTED]@db:5432/x'],
    ['a secret assignment', 'API_KEY="hunter2!!"', 'API_KEY="[REDACTED]"'],
    [
      'a JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      '[REDACTED:jwt]',
    ],
    [
      'a private key block',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
      '[REDACTED:private-key]',
    ],
    ['the home directory', 'cwd /Users/alice/repo', 'cwd ~/repo'],
  ])('masks %s', (_, input, expected) => {
    expect(redact(input).text).toBe(expected);
  });

  it.each([
    ['password=password', 'password=[REDACTED]'],
    ['password=pass', 'password=[REDACTED]'],
    ['token: token-token', 'token: [REDACTED]'],
  ])(
    'masks the captured value, not an earlier copy of it in the field name: %s',
    (input, expected) => {
      expect(redact(input).text).toBe(expected);
    },
  );

  it('does not treat a $VAR reference as a secret value', () => {
    expect(redact('echo "token=$MY_TOKEN"').text).toBe('echo "token=$MY_TOKEN"');
  });

  it('does not mask another user whose home shares a prefix', () => {
    expect(redact('/Users/alicesmith/x').text).toBe('/Users/alicesmith/x');
  });

  it('applies literal and /regex/ custom patterns', () => {
    expect(redact('order #4411 for acme.internal', {}, ['acme.internal', '/#\\d+/']).text).toBe(
      'order [REDACTED] for [REDACTED]',
    );
  });

  it('resolves overlaps in favor of the earliest, longest match', () => {
    const r = redactor({ DB_PASSWORD: 'longer-secret-value' });
    const matches = r.find('password=longer-secret-value');
    expect(matches).toHaveLength(1);
    expect(applyMatches('password=longer-secret-value', matches)).toBe(
      'password=[REDACTED:DB_PASSWORD]',
    );
  });
});

describe('redactChunks', () => {
  it('catches a secret split across chunks and keeps one piece per chunk', () => {
    const log = new RedactionLog();
    const chunks = redactChunks(redactor({ GH_TOKEN: 'tok-123456789' }), log, [
      'a tok-12',
      '34567',
      '89 b',
      ' c',
    ]);
    expect(chunks).toEqual(['a [REDACTED:GH_TOKEN]', '', ' b', ' c']);
    expect(chunks.join('')).toBe('a [REDACTED:GH_TOKEN] b c');
    expect(log.toJSON()).toEqual([{ count: 1, rule: 'env-secret' }]);
  });

  it('handles several matches in one chunk and none in others', () => {
    const chunks = redactChunks(
      redactor({ A_TOKEN: 'aaaaaaa', B_TOKEN: 'bbbbbbb' }),
      new RedactionLog(),
      ['x aaaaaaa y bbbbbbb', ' z'],
    );
    expect(chunks).toEqual(['x [REDACTED:A_TOKEN] y [REDACTED:B_TOKEN]', ' z']);
  });

  it('returns the chunks unchanged when nothing matches', () => {
    const input = ['plain', ' text'];
    expect(redactChunks(redactor(), new RedactionLog(), input)).toBe(input);
  });
});
