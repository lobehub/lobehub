import type { ISlashMenuOption } from '@lobehub/editor';

import type { MentionCategory, MentionCategoryId } from './MentionMenu/types';

/** Sections an uninstalled agent may join or follow. */
export const AGENT_CATEGORY_IDS: MentionCategoryId[] = [
  'agent',
  'agent-private',
  'agent-workspace',
];
/** Sections the skill section follows when it has to be created. */
export const SKILL_PRECEDING_IDS: MentionCategoryId[] = [...AGENT_CATEGORY_IDS, 'member', 'topic'];

/** Entries per group in the menu before the user types. */
export const DEFAULT_MENTION_GROUP_LIMIT = 3;
/** Entries per group once the user filters by a keyword. */
export const SEARCH_MENTION_GROUP_LIMIT = 8;

/** The agent sections (private / workspace) share one budget, filled in section order. */
const GROUP_OF: Partial<Record<MentionCategoryId, 'agent' | 'skill'>> = {
  'agent': 'agent',
  'agent-private': 'agent',
  'agent-workspace': 'agent',
  'skill': 'skill',
};

export const limitMentionGroups = (
  categories: MentionCategory[],
  limit: number,
): MentionCategory[] => {
  const remaining = { agent: limit, skill: limit };

  return categories
    .map((category) => {
      const group = GROUP_OF[category.id];
      if (!group) return category;

      const items = category.items.slice(0, Math.max(remaining[group], 0));
      remaining[group] -= items.length;
      return { ...category, items };
    })
    .filter((category) => category.items.length > 0);
};

/** Append entries to a category (created after `afterId` when missing), skipping keys already listed. */
export const mergeIntoCategory = (
  categories: MentionCategory[],
  extra: Omit<MentionCategory, 'items'> & { items: ISlashMenuOption[] },
  afterIds: MentionCategoryId[],
): MentionCategory[] => {
  if (extra.items.length === 0) return categories;

  const existing = categories.find((category) => category.id === extra.id);
  if (existing) {
    const keys = new Set(existing.items.map((item) => String(item.key)));
    const items = [...existing.items, ...extra.items.filter((item) => !keys.has(String(item.key)))];
    return categories.map((category) =>
      category === existing ? { ...category, items } : category,
    );
  }

  let insertAt = 0;
  for (let i = categories.length - 1; i >= 0; i--) {
    if (afterIds.includes(categories[i].id)) {
      insertAt = i + 1;
      break;
    }
  }
  return [...categories.slice(0, insertAt), extra, ...categories.slice(insertAt)];
};
