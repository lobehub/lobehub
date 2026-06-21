export const LOBE_ROUTE_VIEW_COOKIE = 'LOBE_ROUTE_VIEW';
export const LOBE_ROUTE_VIEW_QUERY = 'lobe_route_view';

export const RouteViewPreference = {
  Desktop: 'desktop',
  Mobile: 'mobile',
} as const;

export type RouteViewPreference = (typeof RouteViewPreference)[keyof typeof RouteViewPreference];

export const parseRouteViewPreference = (
  value?: null | string,
): RouteViewPreference | undefined => {
  if (value === RouteViewPreference.Desktop) return RouteViewPreference.Desktop;
  if (value === RouteViewPreference.Mobile) return RouteViewPreference.Mobile;

  return undefined;
};
