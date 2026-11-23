import { COMPOSIO_APP_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { type UserCredSummary } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { credSiteIcon } from './CredIcon';

const cred = (patch: Partial<UserCredSummary>): UserCredSummary => ({
  createdAt: '2026-11-01T00:00:00Z',
  id: 1,
  key: 'key',
  name: 'name',
  type: 'kv-env',
  updatedAt: '2026-11-01T00:00:00Z',
  ...patch,
});

const connector = (id: string) => LOBEHUB_SKILL_PROVIDERS.find((p) => p.id === id)!.icon;

describe('credSiteIcon', () => {
  it("shows an OAuth item's provider logo", () => {
    expect(credSiteIcon(cred({ key: 'gh-main', oauthProvider: 'github', type: 'oauth' }))).toBe(
      connector('github'),
    );
    expect(credSiteIcon(cred({ key: 'x-main', oauthProvider: 'Linear', type: 'oauth' }))).toBe(
      connector('linear'),
    );
  });

  it('reads the site from the key, whole or by its first word', () => {
    expect(credSiteIcon(cred({ key: 'notion' }))).toBe(connector('notion'));
    expect(credSiteIcon(cred({ key: 'GITHUB_TOKEN' }))).toBe(connector('github'));
    expect(credSiteIcon(cred({ key: 'x' }))).toBe(connector('twitter'));
    expect(credSiteIcon(cred({ key: 'google-calendar', type: 'kv-header' }))).toBe(
      COMPOSIO_APP_TYPES.find((app) => app.identifier === 'google-calendar')!.icon,
    );
  });

  it('has no site for an item that names none', () => {
    expect(credSiteIcon(cred({ key: 'my-api-key' }))).toBeUndefined();
    expect(
      credSiteIcon(cred({ key: 'acme', oauthProvider: 'acme', type: 'oauth' })),
    ).toBeUndefined();
  });
});
