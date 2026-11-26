import { SkillCategory } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getSkillCategoryStyle } from './skillCategoryStyle';

describe('getSkillCategoryStyle', () => {
  it('gives every market category a tile color, a three-stop gradient and an icon', () => {
    const categories = Object.values(SkillCategory).filter((value) => value !== SkillCategory.All);

    for (const category of categories) {
      const style = getSkillCategoryStyle(category);
      expect(style, category).toBeDefined();
      expect(style!.tile).toMatch(/^#[\dA-F]{6}$/i);
      expect(style!.gradient).toHaveLength(3);
      style!.gradient.forEach((stop) => expect(stop).toMatch(/^#[\dA-F]{6}$/i));
      expect(style!.icon).toBeTruthy();
    }
  });

  it('has no style for a missing or unknown category, so the plain Surface tile shows', () => {
    expect(getSkillCategoryStyle()).toBeUndefined();
    expect(getSkillCategoryStyle(null)).toBeUndefined();
    expect(getSkillCategoryStyle('not-a-category')).toBeUndefined();
  });
});
