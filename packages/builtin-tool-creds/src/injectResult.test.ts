import { describe, expect, it } from 'vitest';

import { buildInjectCredsResult } from './injectResult';

describe('buildInjectCredsResult', () => {
  it('lists the variable names a single key injected, without values', () => {
    const result = buildInjectCredsResult(['deepseek'], {
      credentials: { env: { DEEPSEEK_API_KEY: 'sk******ab' } },
      notFound: [],
    });

    expect(result.content).toBe(
      [
        'Credentials injected successfully: deepseek.',
        'Injected per key (variable names only, values are never shown):',
        '- deepseek → DEEPSEEK_API_KEY',
      ].join('\n'),
    );
    expect(result.envVarsByKey).toEqual({ deepseek: ['DEEPSEEK_API_KEY'] });
    expect(result.content).not.toContain('sk******ab');
  });

  it('maps several keys using the server-resolved mapping', () => {
    const result = buildInjectCredsResult(['lobehub-database', 'deepseek'], {
      credentials: {
        env: {
          CLOUD_DATABASE_URL: 'po******db',
          DEEPSEEK_API_KEY: 'sk******ab',
          LOBEHUB_DATABASE_URL: 'po******db',
          MARKET_DATABASE_URL: 'po******db',
        },
      },
      envVarsByKey: {
        'deepseek': ['DEEPSEEK_API_KEY'],
        'lobehub-database': ['LOBEHUB_DATABASE_URL', 'CLOUD_DATABASE_URL', 'MARKET_DATABASE_URL'],
      },
    });

    expect(result.content).toContain(
      '- lobehub-database → LOBEHUB_DATABASE_URL, CLOUD_DATABASE_URL, MARKET_DATABASE_URL',
    );
    expect(result.content).toContain('- deepseek → DEEPSEEK_API_KEY');
    expect(result.unattributedEnvVars).toEqual([]);
    expect(result.content).not.toContain('******');
  });

  it('lists names it cannot attribute instead of guessing', () => {
    const result = buildInjectCredsResult(['a', 'b'], {
      credentials: { env: { A_1: 'x', B_1: 'y' } },
    });

    expect(result.envVarsByKey).toEqual({});
    expect(result.content).toContain('- (unattributed) → A_1, B_1');
  });

  it('includes file paths and keeps the not-found and unsupported notes', () => {
    const result = buildInjectCredsResult(['gcp', 'missing', 'header'], {
      credentials: {
        env: {},
        files: [{ filename: 'sa.json', key: 'gcp', path: '~/.creds/files/sa.json' }],
      },
      notFound: ['missing'],
      unsupportedInSandbox: ['header'],
    });

    expect(result.content).toBe(
      [
        'Credentials injected successfully: gcp, header.',
        'Injected per key (variable names only, values are never shown):',
        '- gcp → file ~/.creds/files/sa.json',
        'Not found: missing. Please configure them in Settings > Credentials. Not supported in sandbox: header.',
      ].join('\n'),
    );
    expect(result.notFound).toEqual(['missing']);
  });

  it('passes the credentials on with every env value redacted', () => {
    const files = [{ filename: 'key.json', key: 'gcp', path: '~/.creds/files/key.json' }];
    const result = buildInjectCredsResult(['deepseek', 'gcp'], {
      credentials: { env: { DEEPSEEK_API_KEY: 'sk******ab' }, files },
      envVarsByKey: { deepseek: ['DEEPSEEK_API_KEY'] },
    });

    expect(result.credentials).toEqual({ env: { DEEPSEEK_API_KEY: '******' }, files });
    expect(JSON.stringify(result)).not.toContain('sk******ab');
  });

  describe('credential keys named like Object.prototype members', () => {
    it('does not read an inherited property for a file-only key', () => {
      const result = buildInjectCredsResult(['constructor'], {
        credentials: {
          env: {},
          files: [{ filename: 'sa.json', key: 'constructor', path: '~/.creds/files/sa.json' }],
        },
      });

      expect(result.content).toBe(
        [
          'Credentials injected successfully: constructor.',
          'Injected per key (variable names only, values are never shown):',
          '- constructor → file ~/.creds/files/sa.json',
        ].join('\n'),
      );
      expect(result.envVarsByKey).toEqual({});
    });

    it('ignores inherited entries of the server-resolved mapping', () => {
      const result = buildInjectCredsResult(['hasOwnProperty', 'deepseek'], {
        credentials: { env: { DEEPSEEK_API_KEY: 'sk******ab' } },
        envVarsByKey: { deepseek: ['DEEPSEEK_API_KEY'] },
      });

      expect(result.envVarsByKey).toEqual({ deepseek: ['DEEPSEEK_API_KEY'] });
      expect(result.content).toContain('- deepseek → DEEPSEEK_API_KEY');
      expect(result.content).not.toContain('hasOwnProperty →');
    });

    it('keeps a `__proto__` key as an own, serializable entry', () => {
      const result = buildInjectCredsResult(['__proto__'], {
        credentials: { env: { PROTO_TOKEN: 'ab******cd' } },
      });

      expect(Object.hasOwn(result.envVarsByKey, '__proto__')).toBe(true);
      expect(JSON.stringify(result.envVarsByKey)).toBe('{"__proto__":["PROTO_TOKEN"]}');
      expect(result.unattributedEnvVars).toEqual([]);
      expect(result.content).toContain('- __proto__ → PROTO_TOKEN');
    });
  });
});
