import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/Settings/skill/features/SkillList', () => ({ default: () => null }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

const { buildInstalledDetailPath, getInstalledVisibility } = await import('./InstalledNav');

describe('buildInstalledDetailPath', () => {
  it('opens one installed item on its installed page', () => {
    expect(buildInstalledDetailPath('skill', 'skill_123', 'agent-skill')).toBe(
      '/marketplace/skill/installed?open=agent-skill%3Askill_123',
    );
    expect(buildInstalledDetailPath('connector', 'acme:ci', 'mcp-connector')).toBe(
      '/marketplace/connector/installed?open=mcp-connector%3Aacme%3Aci',
    );
  });
});

describe('getInstalledVisibility', () => {
  it('has no tab outside a workspace or for skills', () => {
    expect(getInstalledVisibility('connector', null, 'private')).toBeUndefined();
    expect(getInstalledVisibility('skill', 'ws_1', 'private')).toBeUndefined();
  });

  it('lists the tab the installed page is on, the shared pool by default', () => {
    expect(getInstalledVisibility('connector', 'ws_1', null)).toBe('public');
    expect(getInstalledVisibility('connector', 'ws_1', 'private')).toBe('private');
  });
});

describe('buildInstalledDetailPath in a workspace', () => {
  // A private and a shared connector may share an identifier; without the tab
  // the installed page resolves the shared row.
  it('opens a private connector on the Private tab', () => {
    expect(buildInstalledDetailPath('connector', 'acme', 'mcp-connector', 'private')).toBe(
      '/marketplace/connector/installed?open=mcp-connector%3Aacme&visibility=private',
    );
  });

  it('opens a shared connector on the default (shared) tab', () => {
    expect(buildInstalledDetailPath('connector', 'acme', 'mcp-connector', 'public')).toBe(
      '/marketplace/connector/installed?open=mcp-connector%3Aacme',
    );
  });
});
