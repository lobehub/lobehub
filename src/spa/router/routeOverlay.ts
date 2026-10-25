import type { RouteObject } from 'react-router';

/** Rewrites one route of a reused tree; `null` drops it. */
export type RouteOverlay = (route: RouteObject) => RouteObject | null;

const joinKey = (base: string, segment: string) => (base ? `${base}/${segment}` : segment);

/**
 * Reuse a route tree defined for another router (desktop → mobile) and adjust
 * only the routes that differ, so the copy cannot drift from its source.
 *
 * Overlay keys are paths relative to the tree root; an index route is
 * `<parent>/index` (`index` at the root). Pathless layout routes have no key.
 */
export const overlayRoutes = (
  routes: readonly RouteObject[],
  overlays: Readonly<Record<string, RouteOverlay>>,
  base = '',
): RouteObject[] =>
  routes.flatMap((route) => {
    const childBase = route.path ? joinKey(base, route.path) : base;
    const next = (
      route.children
        ? { ...route, children: overlayRoutes(route.children, overlays, childBase) }
        : route
    ) as RouteObject;
    const key = route.index ? joinKey(base, 'index') : route.path ? childBase : undefined;
    const overlay = key === undefined ? undefined : overlays[key];
    if (!overlay) return [next];

    const result = overlay(next);
    return result ? [result] : [];
  });

/** Overlay that merges extra fields into the route's `handle`. */
export const withHandle =
  (extra: Record<string, unknown>): RouteOverlay =>
  (route) =>
    ({ ...route, handle: { ...(route.handle as object), ...extra } }) as RouteObject;

/** Overlay that drops the route. */
export const dropRoute: RouteOverlay = () => null;
