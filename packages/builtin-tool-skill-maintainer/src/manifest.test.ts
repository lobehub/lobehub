import { describe, expect, it } from 'vitest';

import { SkillMaintainerManifest } from './manifest';

describe('SkillMaintainerManifest', () => {
  /**
   * @example
   * The hidden skill maintainer exposes only the document-backed v1 tool surface.
   */
  it('exposes only the v1 skill-management tools', () => {
    expect(SkillMaintainerManifest.api.map((item) => item.name).sort()).toEqual([
      'createSkill',
      'getSkill',
      'listSkills',
      'renameSkill',
      'replaceSkillIndex',
    ]);
  });

  /**
   * @example
   * Path, resource, delete, and broad exploration APIs stay out of the active manifest.
   */
  it('does not expose forbidden v1 APIs', () => {
    const names = SkillMaintainerManifest.api.map((item) => item.name);

    expect(names).not.toContain('consolidate');
    expect(names).not.toContain('deleteSkill');
    expect(names).not.toContain('forkSkill');
    expect(names).not.toContain('listSkillResources');
    expect(names).not.toContain('mergeSkill');
    expect(names).not.toContain('readSkillFile');
    expect(names).not.toContain('removeSkillFile');
    expect(names).not.toContain('writeSkillFile');
  });
});
