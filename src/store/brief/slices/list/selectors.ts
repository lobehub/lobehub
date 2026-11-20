import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';

import { BRIEF_LIST_KEY, type NewsDay } from './projection';

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

/** The digest of one local day, `undefined` until it is hydrated or fetched in the active scope. */
const newsDay =
  (day: string) =>
  (s: BriefStore): NewsDay | undefined =>
    s.briefNewsMap[day];

/**
 * Whether the server has answered for this day in the active scope. A digest
 * restored from storage may be a stale snapshot, so an empty restored day is
 * still "loading" — not "nothing happened today" — until this is true.
 */
const isNewsDayConfirmed =
  (day: string) =>
  (s: BriefStore): boolean => {
    const source = s.briefNewsReplica.entries[day]?.source;
    return source === 'server' || source === 'local';
  };

/**
 * The digest of a day once it can be painted: any restored rows, or an empty
 * day only after the server confirmed it. `undefined` reads as loading.
 */
const paintableNewsDay =
  (day: string) =>
  (s: BriefStore): NewsDay | undefined => {
    const data = s.briefNewsMap[day];
    if (!data) return undefined;
    return data.news.length > 0 || isNewsDayConfirmed(day)(s) ? data : undefined;
  };

export const briefNewsSelectors = {
  isNewsDayConfirmed,
  newsDay,
  paintableNewsDay,
};
