import type { SkillListItem } from './SkillsList';

/** Case-insensitive match on the skill name and its description. */
export const filterSkillItems = (items: SkillListItem[], query: string): SkillListItem[] => {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return items;

  return items.filter(
    ({ description, name }) =>
      name.toLowerCase().includes(keyword) || description?.toLowerCase().includes(keyword),
  );
};
