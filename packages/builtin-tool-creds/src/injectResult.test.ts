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
});
