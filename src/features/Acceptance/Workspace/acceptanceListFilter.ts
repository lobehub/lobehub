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
  /**
   * The workspace (`personal` for none) the project choice was made in. Project
   * ids belong to one workspace, so a choice carried into another would send a
   * foreign id and read as an empty list.
   */
  projectScope?: string;
  scope: AcceptanceListScope;
  source: AcceptanceListSource;
}

/** The key a project choice is scoped to: the active workspace, or `personal`. */
export const acceptanceProjectScopeKey = (workspaceId?: string | null) => workspaceId ?? 'personal';

export const DEFAULT_ACCEPTANCE_LIST_FACETS: AcceptanceListFacets = { scope: 'all', source: 'all' };

/**
 * Persisted facets are untrusted — a stale or hand-edited value falls back per
 * field. A project choice made in another workspace is dropped.
 */
export const normalizeAcceptanceListFacets = (
  value: unknown,
  projectScope: string = acceptanceProjectScopeKey(),
): AcceptanceListFacets => {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const scope = ACCEPTANCE_LIST_SCOPES.find((item) => item === raw.scope) ?? 'all';
  const source = ACCEPTANCE_LIST_SOURCES.find((item) => item === raw.source) ?? 'all';
  const sameScope = (raw.projectScope ?? acceptanceProjectScopeKey()) === projectScope;
  const projectId = !sameScope
    ? undefined
    : raw.projectId === null
      ? null
      : typeof raw.projectId === 'string'
        ? raw.projectId
        : undefined;
  return { projectId, projectScope, scope, source };
};

/**
 * The facets a list actually applies. A project page hosts its own list: the
 * page's project replaces the persisted project facet, which belongs to the
 * standalone list and is not even offered in the hosted menu.
 */
export const effectiveAcceptanceListFacets = (
  facets: AcceptanceListFacets,
  hostProjectId?: string,
): AcceptanceListFacets => (hostProjectId ? { ...facets, projectId: hostProjectId } : facets);

/**
 * What "show all" resets the persisted facets to. On a hosted list it must not
 * wipe the standalone list's project choice — the user never saw it here.
 */
export const resetAcceptanceListFacets = (
  facets: AcceptanceListFacets,
  hostProjectId?: string,
): AcceptanceListFacets =>
  hostProjectId
    ? {
        ...DEFAULT_ACCEPTANCE_LIST_FACETS,
        projectId: facets.projectId,
        projectScope: facets.projectScope,
      }
    : DEFAULT_ACCEPTANCE_LIST_FACETS;

/** Whether the facets narrow the list beyond what its host already fixes. */
export const isAcceptanceListFacetsNarrowed = (
  { projectId, scope, source }: AcceptanceListFacets,
  hostProjectId?: string,
): boolean => scope !== 'all' || source !== 'all' || (!hostProjectId && projectId !== undefined);

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
