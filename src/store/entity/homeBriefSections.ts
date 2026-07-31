import { type BriefItem, NEWS_BRIEF_TYPES } from '@lobechat/types';

export type HomeBriefSection = 'needsYou' | 'news';

const NEEDS_YOU_ORDER: Record<string, number> = {
  decision: 0,
  error: 9,
};

export const isHomeNewsBrief = (brief: Pick<BriefItem, 'type'>): boolean =>
  NEWS_BRIEF_TYPES.includes(brief.type);

export const compareHomeNeedsYouBriefs = (
  a: Pick<BriefItem, 'type'>,
  b: Pick<BriefItem, 'type'>,
): number => (NEEDS_YOU_ORDER[a.type] ?? 5) - (NEEDS_YOU_ORDER[b.type] ?? 5);
