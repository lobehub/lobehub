import './Github/definition';

import { describe, expect, it } from 'vitest';

import { filterIntegrations, findIntegration, INTEGRATIONS, isIntegrationId } from './registry';

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

  it('matches the search on name and keywords, case-insensitively', () => {
    expect(filterIntegrations('').map((i) => i.id)).toEqual(INTEGRATIONS.map((i) => i.id));
    expect(filterIntegrations('GIT').map((i) => i.id)).toContain('github');
    expect(filterIntegrations('pull request').map((i) => i.id)).toContain('github');
    expect(filterIntegrations('jira')).toEqual([]);
  });
});
