import { createElement, isValidElement, type ReactElement, type ReactNode, Suspense } from 'react';
import type { RouteObject } from 'react-router';

import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import RouteSegmentSkeleton from '@/components/Skeleton/RouteSegment';

/**
 * Swap the default brand-loading fallback for a structural segment skeleton.
 *
 * `dynamicElement` / `dynamicLayout` wrap every route element in their own
 * `Suspense`, and that boundary is always nearer the suspending component than
 * any outlet-level one — so a fallback set on the main layout's outlet never
 * fires for route content, and the 100+ call sites would otherwise each need
 * the option. Explicit route fallbacks are preserved so a route can render the
 * nearest segment skeleton instead. Rewriting only defaults here keeps the main
 * area consistent without touching routes outside it (mobile still wants the
 * full-page brand loading, since its nav bar is inside the same boundary as its
 * outlet).
 */
export const withSegmentFallback = (routes: RouteObject[]): RouteObject[] =>
  routes.map((route) => {
    const suspenseElement =
      isValidElement(route.element) && route.element.type === Suspense
        ? (route.element as ReactElement<{ fallback: ReactNode }>)
        : undefined;
    const fallback = suspenseElement?.props.fallback;
    const element =
      suspenseElement && isValidElement(fallback) && fallback.type === BrandTextLoading
        ? // This intentionally couples to `dynamicElement` / `dynamicLayout`
          // returning a bare Suspense with BrandTextLoading as their default.
          // Explicit segment fallbacks must pass through unchanged.
          createElement(Suspense, {
            ...suspenseElement.props,
            fallback: <RouteSegmentSkeleton />,
            key: suspenseElement.key,
          })
        : route.element;

    // `RouteObject` is a discriminated union of index / non-index routes, and
    // spreading loses the discriminant — the copy keeps the original's shape.
    return {
      ...route,
      ...(route.children && { children: withSegmentFallback(route.children) }),
      element,
    } as RouteObject;
  });
