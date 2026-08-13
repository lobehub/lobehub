import type { ExpertiseLessonItem } from '@/services/expertise';

import type { ExpertiseTier } from './types';

export const TIER_ORDER: ExpertiseTier[] = ['core', 'niche', 'unused'];

export const groupLessons = (lessons: ExpertiseLessonItem[], limit?: number) => {
  const selected = [...lessons].sort((a, b) => b.hitCount - a.hitCount).slice(0, limit);
  const map = new Map<ExpertiseTier, ExpertiseLessonItem[]>();

  for (const lesson of selected) {
    const tier = lesson.tier as ExpertiseTier;
    map.set(tier, [...(map.get(tier) ?? []), lesson]);
  }

  return TIER_ORDER.map((tier) => ({ items: map.get(tier) ?? [], tier })).filter(
    (group) => group.items.length > 0,
  );
};
