import { afterEach, describe, expect, it, vi } from 'vitest';

import { filterBuiltinSkills, shouldEnableBuiltinSkill } from './skillFilters';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('skillFilters', () => {
  it('should disable agent-browser on web environment', () => {
    expect(shouldEnableBuiltinSkill('lobe-agent-browser', { isDesktop: false })).toBe(false);
  });

  it('should enable agent-browser on desktop (non-Windows) environment', () => {
    expect(shouldEnableBuiltinSkill('lobe-agent-browser', { isDesktop: true })).toBe(true);
  });

  it('should enable agent-browser on desktop Windows', () => {
    expect(shouldEnableBuiltinSkill('lobe-agent-browser', { isDesktop: true })).toBe(true);
  });

  it('should not be affected by Windows platform detection when desktop is enabled', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.resetModules();

    const { shouldEnableBuiltinSkill } = await import('./skillFilters');

    expect(shouldEnableBuiltinSkill('lobe-agent-browser', { isDesktop: true })).toBe(true);
  });

  it('should keep non-desktop-only skills enabled', () => {
    expect(shouldEnableBuiltinSkill('lobe-artifacts', { isDesktop: false })).toBe(true);
  });

  it('should filter builtin skills by platform context', () => {
    const skills = [
      {
        content: 'agent-browser',
        description: 'agent-browser',
        identifier: 'lobe-agent-browser',
        name: 'Agent Browser',
        source: 'builtin' as const,
      },
      {
        content: 'artifacts',
        description: 'artifacts',
        identifier: 'lobe-artifacts',
        name: 'Artifacts',
        source: 'builtin' as const,
      },
    ];

    const filtered = filterBuiltinSkills(skills, { isDesktop: false });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].identifier).toBe('lobe-artifacts');
  });
});
