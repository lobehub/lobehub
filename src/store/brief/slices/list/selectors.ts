import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';

import { BRIEF_LIST_KEY } from './projection';

/** Stable identity so an unloaded feed never churns `shallow`-compared subscribers. */
const EMPTY_BRIEFS: BriefItem[] = [];

/**
 * The unresolved feed of the active identity scope. Briefs are per-user AND
 * per-workspace rows, and a list left over from another scope holds ids that
 * are unreachable here. The replica clears its view on a scope switch (before
 * paint), so a miss means "not loaded yet" — the surface then paints its
 * skeleton instead of unreachable cards.
 */
const briefs = (s: BriefStore): BriefItem[] => s.briefListMap[BRIEF_LIST_KEY] ?? EMPTY_BRIEFS;

const hasBriefs = (s: BriefStore): boolean => briefs(s).length > 0;

/** Whether the feed has a confirmed value (hydrated from storage or fetched) for the active scope. */
const isBriefsInit = (s: BriefStore): boolean => s.briefListMap[BRIEF_LIST_KEY] !== undefined;

export const briefListSelectors = {
  briefs,
  hasBriefs,
  isBriefsInit,
};
