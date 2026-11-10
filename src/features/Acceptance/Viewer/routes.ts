import { createContext, use } from 'react';

/** The standalone acceptance pages; a project mounts the same pages under its own section. */
export const ACCEPTANCE_ROUTE_BASE = '/acceptance';

export const acceptanceHomePath = () => '/';

export const acceptanceListPath = (base = ACCEPTANCE_ROUTE_BASE) => base;

export const acceptanceOverviewPath = (acceptanceId: string, base = ACCEPTANCE_ROUTE_BASE) =>
  `${base}/${encodeURIComponent(acceptanceId)}`;

export const acceptanceCheckPath = (
  acceptanceId: string,
  checkId: string,
  base = ACCEPTANCE_ROUTE_BASE,
) => `${acceptanceOverviewPath(acceptanceId, base)}/check/${encodeURIComponent(checkId)}`;

/**
 * Where the acceptance pages of this tree live. A project's acceptance section
 * provides its own base so opening a record or a check stays inside the
 * project instead of jumping to the standalone (web-only) `/acceptance`.
 */
export const AcceptanceRouteBaseContext = createContext(ACCEPTANCE_ROUTE_BASE);

export const useAcceptanceRouteBase = () => use(AcceptanceRouteBaseContext);
