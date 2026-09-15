import { describe, expect, it, vi } from 'vitest';

import {
  checkGatewayConfig,
  collectGatewayConfigIssues,
  PUBLIC_EXAMPLE_JWKS_KID,
} from './checkGatewayConfig.js';

const jwks = (kid: string) => JSON.stringify({ keys: [{ alg: 'RS256', kid, kty: 'RSA' }] });

const configured = {
  AGENT_GATEWAY_SERVICE_TOKEN: 'token',
  AGENT_GATEWAY_URL: 'http://localhost:8787',
  ENABLE_AGENT_GATEWAY: '1',
  JWKS_KEY: jwks('fresh-key'),
};

describe('collectGatewayConfigIssues', () => {
  it('reports nothing for a fully configured gateway', () => {
    expect(collectGatewayConfigIssues(configured)).toEqual([]);
  });

  it('ignores gateway settings when Gateway Mode is not enabled', () => {
    expect(collectGatewayConfigIssues({ JWKS_KEY: jwks('fresh-key') })).toEqual([]);
  });

  it('lists every missing variable for an upgrade that kept the old .env', () => {
    const issues = collectGatewayConfigIssues({
      AGENT_GATEWAY_SERVICE_TOKEN: '',
      ENABLE_AGENT_GATEWAY: '1',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].vars).toEqual(['AGENT_GATEWAY_URL', 'GATEWAY_SERVICE_TOKEN', 'JWKS_KEY']);
  });

  it('treats setup.sh placeholders as missing', () => {
    const issues = collectGatewayConfigIssues({
      ...configured,
      AGENT_GATEWAY_SERVICE_TOKEN: 'YOUR_GATEWAY_SERVICE_TOKEN',
      JWKS_KEY: 'YOUR_JWKS_KEY',
    });

    expect(issues[0].vars).toEqual(['GATEWAY_SERVICE_TOKEN', 'JWKS_KEY']);
  });

  it('flags a JWKS_KEY that is not valid JSON', () => {
    const issues = collectGatewayConfigIssues({ ...configured, JWKS_KEY: '{not json' });

    expect(issues[0].vars).toEqual(['JWKS_KEY (not valid JWKS JSON)']);
  });

  it('flags the public example JWKS_KEY even when Gateway Mode is off', () => {
    const issues = collectGatewayConfigIssues({ JWKS_KEY: jwks(PUBLIC_EXAMPLE_JWKS_KID) });

    expect(issues.map((issue) => issue.name)).toEqual(['Public example JWKS_KEY']);
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
