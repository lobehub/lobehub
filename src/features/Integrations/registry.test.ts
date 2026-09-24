import './Github/definition';

import { describe, expect, it } from 'vitest';

import { findIntegration, INTEGRATIONS, isIntegrationId, UPCOMING_INTEGRATIONS } from './registry';

describe('integrations registry', () => {
  it('registers GitHub once, even when the definition module is evaluated again', async () => {
    await import('./Github/definition');
    expect(INTEGRATIONS.filter((item) => item.id === 'github')).toHaveLength(1);
  });

  it('resolves ids used as settings sub-routes', () => {
    expect(isIntegrationId('github')).toBe(true);
    expect(isIntegrationId('slack')).toBe(false);
    expect(isIntegrationId(undefined)).toBe(false);
    expect(findIntegration('github')?.name).toBe('GitHub');
  });

  it('keeps upcoming integrations out of the routable set', () => {
    for (const item of UPCOMING_INTEGRATIONS) {
      expect(isIntegrationId(item.id)).toBe(false);
    }
  });
});
