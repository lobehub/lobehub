import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/Settings/skill/features/SkillList', () => ({ default: () => null }));

const { buildInstalledDetailPath, getInstalledKind } = await import('./InstalledNav');

describe('getInstalledKind', () => {
  it.each([
    ['skill', 'skill'],
    ['skill/installed', 'skill'],
    ['skill/some-skill', 'skill'],
    ['connector', 'connector'],
    ['connector/installed', 'connector'],
    // MCP detail pages belong to Connectors, which absorbed the MCP list.
    ['mcp/notion', 'connector'],
  ])('lists the installed library of %s', (subPath, kind) => {
    expect(getInstalledKind(subPath)).toBe(kind);
  });

  it.each([undefined, '', 'agent', 'model', 'provider/openai'])(
    'lists nothing on %s',
    (subPath) => {
      expect(getInstalledKind(subPath)).toBeUndefined();
    },
  );
});

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
