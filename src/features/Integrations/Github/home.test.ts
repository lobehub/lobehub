import { describe, expect, it } from 'vitest';

import { buildGithubConnectorPath, isGithubConnector } from './home';

const query = (path: string) => new URLSearchParams(path.split('?')[1]);

describe('buildGithubConnectorPath', () => {
  it('opens the GitHub connector in the Marketplace', () => {
    const path = buildGithubConnectorPath();

    expect(path).toBe('/marketplace/app/github');
  });

  it('carries the install result over from the old page', () => {
    const params = query(buildGithubConnectorPath('?installed=ok&account=octo&pending=claim-1'));

    expect(params.get('installed')).toBe('ok');
    expect(params.get('account')).toBe('octo');
    expect(params.get('pending')).toBe('claim-1');
  });

  it('drops anything else in the old query', () => {
    expect(query(buildGithubConnectorPath('?open=plugin:evil&foo=1')).get('foo')).toBeNull();
    expect(query(buildGithubConnectorPath('?open=plugin:evil')).get('open')).toBeNull();
  });
});

describe('isGithubConnector', () => {
  it('matches only the GitHub connector', () => {
    expect(isGithubConnector('github')).toBe(true);
    expect(isGithubConnector('linear')).toBe(false);
  });
});
