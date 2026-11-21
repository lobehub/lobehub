import { describe, expect, it } from 'vitest';

import {
  buildConnectorPagePath,
  buildLegacyIntegrationPath,
  hasConnectorPage,
} from './connectorPage';

const query = (path: string) => new URLSearchParams(path.split('?')[1]);

describe('buildConnectorPagePath', () => {
  it.each(['github', 'linear'] as const)('opens the %s connector in the Marketplace', (id) => {
    const path = buildConnectorPagePath(id);

    expect(path).toBe(`/marketplace/app/${id}`);
  });

  it('carries the install result over', () => {
    const params = query(
      buildConnectorPagePath('github', '?installed=ok&account=octo&pending=claim-1'),
    );

    expect(params.get('installed')).toBe('ok');
    expect(params.get('account')).toBe('octo');
    expect(params.get('pending')).toBe('claim-1');
  });

  it('drops anything else in the old query', () => {
    const params = query(buildConnectorPagePath('linear', '?open=plugin:other&foo=1'));

    expect(params.get('foo')).toBeNull();
    expect(params.get('open')).toBeNull();
  });
});

describe('buildLegacyIntegrationPath', () => {
  it('sends an integration page to its connector with the callback result', () => {
    const params = query(buildLegacyIntegrationPath('linear', '?error=access_denied'));

    expect(params.get('open')).toBeNull();
    expect(params.get('error')).toBe('access_denied');
  });

  it('sends the directory and unknown pages to Apps', () => {
    expect(buildLegacyIntegrationPath(undefined)).toBe('/marketplace/app');
    expect(buildLegacyIntegrationPath('vercel', '?installed=ok')).toBe('/marketplace/app');
  });
});

describe('hasConnectorPage', () => {
  it('matches only connectors with an integration behind them', () => {
    expect(hasConnectorPage('github')).toBe(true);
    expect(hasConnectorPage('linear')).toBe(true);
    expect(hasConnectorPage('notion')).toBe(false);
  });
});
