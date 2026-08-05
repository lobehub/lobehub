import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';

/** Stable identity so a scope miss never churns `shallow`-compared subscribers. */
const EMPTY_BRIEFS: BriefItem[] = [];

/**
 * Briefs are per-user AND per-workspace rows. A list left over from another
 * scope is not merely stale — every id in it is unreachable now, so acting on
 * one 404s while the UI shows nothing (the tRPC client only logs non-401
 * failures). Selectors therefore report a scope miss as "not loaded yet", which
 * makes the surface paint its skeleton instead of unreachable cards.
 */
const isScopeCurrent = (s: BriefStore, scope: string) => s.briefsScope === scope;

const briefs = (scope: string) => (s: BriefStore) =>
  isScopeCurrent(s, scope) ? s.briefs : EMPTY_BRIEFS;

const hasBriefs = (scope: string) => (s: BriefStore) =>
  isScopeCurrent(s, scope) && s.briefs.length > 0;

const isBriefsInit = (scope: string) => (s: BriefStore) =>
  isScopeCurrent(s, scope) && s.isBriefsInit;

export const briefListSelectors = {
  briefs,
  hasBriefs,
  isBriefsInit,
};
