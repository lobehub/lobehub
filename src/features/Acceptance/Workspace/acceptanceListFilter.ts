import type { AcceptanceListScope, AcceptanceListSource } from '@/services/verify';

export type AcceptanceListFilter = 'active' | 'all' | 'completed';

export const DEFAULT_ACCEPTANCE_LIST_FILTER: AcceptanceListFilter = 'active';

export const normalizeAcceptanceListFilter = (value: unknown): AcceptanceListFilter =>
  value === 'all' || value === 'completed' ? value : DEFAULT_ACCEPTANCE_LIST_FILTER;

export const ACCEPTANCE_LIST_SCOPES = ['all', 'created', 'participated'] as const;
export const ACCEPTANCE_LIST_SOURCES = ['all', 'topic', 'task', 'goal', 'standalone'] as const;

/**
 * The list narrowings beyond the status split. `projectId`: `undefined` = any
 * project, `null` = filed under none, a string = that project.
 */
export interface AcceptanceListFacets {
  projectId?: string | null;
  scope: AcceptanceListScope;
  source: AcceptanceListSource;
}

export const DEFAULT_ACCEPTANCE_LIST_FACETS: AcceptanceListFacets = { scope: 'all', source: 'all' };

/** Persisted facets are untrusted — a stale or hand-edited value falls back per field. */
export const normalizeAcceptanceListFacets = (value: unknown): AcceptanceListFacets => {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const scope = ACCEPTANCE_LIST_SCOPES.find((item) => item === raw.scope) ?? 'all';
  const source = ACCEPTANCE_LIST_SOURCES.find((item) => item === raw.source) ?? 'all';
  const projectId =
    raw.projectId === null ? null : typeof raw.projectId === 'string' ? raw.projectId : undefined;
  return { projectId, scope, source };
};

export const isAcceptanceListFacetsNarrowed = ({
  projectId,
  scope,
  source,
}: AcceptanceListFacets): boolean => scope !== 'all' || source !== 'all' || projectId !== undefined;

/**
 * Which empty state a zero-result list should render.
 *
 * `filtered` — "no match for this query/filter" plus a show-all escape hatch.
 * `firstRun` — the plain "no acceptances yet" state.
 *
 * A user who owns NOTHING must always read `firstRun`: the default filter is
 * `active`, so their very first visit (e.g. following a shared link) would
 * otherwise show "no active acceptances · show all" — an escape hatch whose
 * click reveals the same nothing. `allListEmpty` stays undefined while the
 * unfiltered probe has not resolved; treat that as "not confirmed empty" so
 * the state never flickers from filtered to firstRun and back.
 */
export const acceptanceListEmptyVariant = ({
  allListEmpty,
  facetsNarrowed = false,
  filter,
  searching,
}: {
  allListEmpty?: boolean;
  facetsNarrowed?: boolean;
  filter: AcceptanceListFilter;
  searching: boolean;
}): 'filtered' | 'firstRun' =>
  (searching || filter !== 'all' || facetsNarrowed) && !allListEmpty ? 'filtered' : 'firstRun';
