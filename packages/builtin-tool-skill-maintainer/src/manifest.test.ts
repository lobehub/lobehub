import { describe, expect, it } from 'vitest';

import { SkillMaintainerManifest } from './manifest';

describe('SkillMaintainerManifest', () => {
  /**
   * @example
   * The hidden skill maintainer exposes the complete v1.2 tool surface.
   */
  it('exposes only the v1.2 skill-management tools', () => {
    expect(SkillMaintainerManifest.api.map((item) => item.name).sort()).toEqual([
      'consolidate',
      'readSkillFile',
      'refine',
      'removeSkillFile',
      'updateSkill',
      'writeSkillFile',
    ]);
  });

  /**
   * @example
   * Lifecycle and broad exploration APIs stay out of the active manifest.
   */
  it('does not expose exploratory or lifecycle mutation tools', () => {
    const names = SkillMaintainerManifest.api.map((item) => item.name);

    expect(names).not.toContain('createSkill');
    expect(names).not.toContain('deleteSkill');
    expect(names).not.toContain('forkSkill');
    expect(names).not.toContain('mergeSkill');
  });
});
