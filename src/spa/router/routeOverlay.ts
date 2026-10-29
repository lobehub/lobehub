import type { RouteObject } from 'react-router';

/** Rewrites one route of a reused tree; `null` drops it. */
export type RouteOverlay = (route: RouteObject) => RouteObject | null;

const joinKey = (base: string, segment: string) => (base ? `${base}/${segment}` : segment);

const applyOverlays = (
  routes: readonly RouteObject[],
  overlays: Readonly<Record<string, RouteOverlay>>,
  used: Set<string>,
  base: string,
): RouteObject[] =>
  routes.flatMap((route) => {
    const childBase = route.path ? joinKey(base, route.path) : base;
    const next = (
      route.children
        ? { ...route, children: applyOverlays(route.children, overlays, used, childBase) }
        : route
    ) as RouteObject;
    const key = route.index ? joinKey(base, 'index') : route.path ? childBase : undefined;
    const overlay = key === undefined ? undefined : overlays[key];
    if (!overlay) return [next];

    used.add(key!);
    const result = overlay(next);
    return result ? [result] : [];
  });

/**
 * Reuse a route tree defined for another router (desktop → mobile) and adjust
 * only the routes that differ, so the copy cannot drift from its source.
 *
 * Overlay keys are paths relative to the tree root; an index route is
 * `<parent>/index` (`index` at the root). Pathless layout routes have no key.
 * A key that matches no route throws: the source tree renamed or removed that
 * route, and the adjustment would otherwise stop applying without a trace.
 */
export const overlayRoutes = (
  routes: readonly RouteObject[],
  overlays: Readonly<Record<string, RouteOverlay>>,
): RouteObject[] => {
  const used = new Set<string>();
  const result = applyOverlays(routes, overlays, used, '');
  const unused = Object.keys(overlays).filter((key) => !used.has(key));
  if (unused.length > 0)
    throw new Error(`overlayRoutes: no route matches overlay key(s) ${unused.join(', ')}`);

  return result;
};

/** Overlay that merges extra fields into the route's `handle`. */
export const withHandle =
  (extra: Record<string, unknown>): RouteOverlay =>
  (route) =>
    ({ ...route, handle: { ...(route.handle as object), ...extra } }) as RouteObject;

/** Overlay that drops the route. */
export const dropRoute: RouteOverlay = () => null;
