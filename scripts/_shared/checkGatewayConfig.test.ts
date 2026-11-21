import { describe, expect, it, vi } from 'vitest';

import {
  checkGatewayConfig,
  collectGatewayConfigIssues,
  PUBLIC_EXAMPLE_JWKS_KID,
} from './checkGatewayConfig.js';

const rsaKey = (kid: string | undefined, fields: Record<string, unknown> = {}) => ({
  alg: 'RS256',
  e: 'AQAB',
  kid,
  kty: 'RSA',
  n: `modulus-${kid}`,
  ...fields,
});

const jwks = (...keys: ReturnType<typeof rsaKey>[]) => JSON.stringify({ keys });

const configured = {
  AGENT_GATEWAY_SERVICE_TOKEN: 'token',
  AGENT_GATEWAY_URL: 'http://localhost:8787',
  ENABLE_AGENT_GATEWAY: '1',
  JWKS_KEY: jwks(rsaKey('fresh-key', { d: 'private-exponent' })),
  JWKS_PUBLIC_KEY: jwks(rsaKey('fresh-key')),
};

describe('collectGatewayConfigIssues', () => {
  it('reports nothing for a fully configured gateway', () => {
    expect(collectGatewayConfigIssues(configured)).toEqual([]);
  });

  it('ignores gateway settings when Gateway Mode is not enabled', () => {
    expect(collectGatewayConfigIssues({ JWKS_KEY: jwks(rsaKey('fresh-key')) })).toEqual([]);
  });

  it('lists every missing variable for an upgrade that kept the old .env', () => {
    const issues = collectGatewayConfigIssues({
      AGENT_GATEWAY_SERVICE_TOKEN: '',
      ENABLE_AGENT_GATEWAY: '1',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].vars).toEqual([
      'AGENT_GATEWAY_URL',
      'GATEWAY_SERVICE_TOKEN',
      'JWKS_KEY',
      'JWKS_PUBLIC_KEY',
    ]);
  });

  it('treats setup.sh placeholders as missing', () => {
    const issues = collectGatewayConfigIssues({
      ...configured,
      AGENT_GATEWAY_SERVICE_TOKEN: 'YOUR_GATEWAY_SERVICE_TOKEN',
      JWKS_KEY: 'YOUR_JWKS_KEY',
      JWKS_PUBLIC_KEY: 'YOUR_JWKS_PUBLIC_KEY',
    });

    expect(issues[0].vars).toEqual(['GATEWAY_SERVICE_TOKEN', 'JWKS_KEY', 'JWKS_PUBLIC_KEY']);
  });

  it('flags a JWKS_KEY that is not valid JSON', () => {
    const issues = collectGatewayConfigIssues({ ...configured, JWKS_KEY: '{not json' });

    expect(issues[0].vars).toEqual(['JWKS_KEY (not valid JWKS JSON)']);
  });

  it('flags the public example JWKS_KEY even when Gateway Mode is off', () => {
    const issues = collectGatewayConfigIssues({ JWKS_KEY: jwks(rsaKey(PUBLIC_EXAMPLE_JWKS_KID)) });

    expect(issues.map((issue) => issue.name)).toEqual(['Public example JWKS_KEY']);
  });

  it('flags an upgrade that still passes the full JWKS_KEY to the gateway', () => {
    const issues = collectGatewayConfigIssues({
      ...configured,
      JWKS_PUBLIC_KEY: configured.JWKS_KEY,
    });

    expect(issues.map((issue) => issue.name)).toEqual(['JWKS_PUBLIC_KEY contains the private key']);
  });

  it('flags a JWKS_PUBLIC_KEY derived from a different key', () => {
    const issues = collectGatewayConfigIssues({
      ...configured,
      JWKS_PUBLIC_KEY: jwks(rsaKey('fresh-key', { n: 'another-modulus' })),
    });

    expect(issues.map((issue) => issue.name)).toEqual(['JWKS_PUBLIC_KEY does not match JWKS_KEY']);
  });

  it('accepts the same rotating key set in a different order', () => {
    const oldPrivate = rsaKey('old-key', { d: 'old-private' });
    const newPrivate = rsaKey('new-key', { d: 'new-private' });

    expect(
      collectGatewayConfigIssues({
        ...configured,
        JWKS_KEY: jwks(oldPrivate, newPrivate),
        JWKS_PUBLIC_KEY: jwks(rsaKey('new-key'), rsaKey('old-key')),
      }),
    ).toEqual([]);
  });

  it('accepts a public-key superset during verifier-first rotation', () => {
    expect(
      collectGatewayConfigIssues({
        ...configured,
        JWKS_KEY: jwks(rsaKey('old-key', { d: 'old-private' })),
        JWKS_PUBLIC_KEY: jwks(rsaKey('old-key'), rsaKey('new-key')),
      }),
    ).toEqual([]);
  });

  it('accepts matching legacy keys that omit kid', () => {
    expect(
      collectGatewayConfigIssues({
        ...configured,
        JWKS_KEY: jwks(rsaKey(undefined, { d: 'old-private' })),
        JWKS_PUBLIC_KEY: jwks(rsaKey(undefined)),
      }),
    ).toEqual([]);
  });

  it('flags a private field on the second public key', () => {
    const issues = collectGatewayConfigIssues({
      ...configured,
      JWKS_KEY: jwks(
        rsaKey('old-key', { d: 'old-private' }),
        rsaKey('new-key', { d: 'new-private' }),
      ),
      JWKS_PUBLIC_KEY: jwks(rsaKey('old-key'), rsaKey('new-key', { d: 'new-private' })),
    });

    expect(issues.map((issue) => issue.name)).toContain('JWKS_PUBLIC_KEY contains the private key');
  });

  it('flags the multi-prime RSA private field on a public key', () => {
    const issues = collectGatewayConfigIssues({
      ...configured,
      JWKS_PUBLIC_KEY: jwks(
        rsaKey('fresh-key', {
          oth: [{ d: 'private-other-d', r: 'private-other-r', t: 'private-other-t' }],
        }),
      ),
    });

    expect(issues.map((issue) => issue.name)).toContain('JWKS_PUBLIC_KEY contains the private key');
  });

  it('flags a public key set that omits a rotating key', () => {
    const issues = collectGatewayConfigIssues({
      ...configured,
      JWKS_KEY: jwks(
        rsaKey('old-key', { d: 'old-private' }),
        rsaKey('new-key', { d: 'new-private' }),
      ),
      JWKS_PUBLIC_KEY: jwks(rsaKey('old-key')),
    });

    expect(issues.map((issue) => issue.name)).toContain('JWKS_PUBLIC_KEY does not match JWKS_KEY');
  });

  it('flags the public example key when it is the second private key', () => {
    const issues = collectGatewayConfigIssues({
      JWKS_KEY: jwks(rsaKey('fresh-key'), rsaKey(PUBLIC_EXAMPLE_JWKS_KID)),
    });

    expect(issues.map((issue) => issue.name)).toEqual(['Public example JWKS_KEY']);
  });

  it.each([
    ['JWKS_KEY', jwks(rsaKey('duplicate'), rsaKey('duplicate'))],
    ['JWKS_PUBLIC_KEY', jwks(rsaKey(''), rsaKey('new-key'))],
  ])('flags ambiguous key ids in %s', (variable, value) => {
    const issues = collectGatewayConfigIssues({ ...configured, [variable]: value });

    expect(issues.map((issue) => issue.name)).toContain('JWKS key ids are ambiguous');
  });
});

describe('checkGatewayConfig', () => {
  it('prints a warning without exiting when configuration is incomplete', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    checkGatewayConfig({ ENABLE_AGENT_GATEWAY: '1' });

    expect(warn.mock.calls.flat().join('\n')).toContain('ACTION REQUIRED');
    expect(exit).not.toHaveBeenCalled();

    warn.mockRestore();
    exit.mockRestore();
  });

  it('stays silent when configuration is complete', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    checkGatewayConfig(configured);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
