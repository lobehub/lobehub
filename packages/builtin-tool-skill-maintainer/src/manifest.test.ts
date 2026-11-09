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
});
