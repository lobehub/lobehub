'use client';

import { createContext, type ReactNode, use } from 'react';

import type { RouteSkeletonChrome } from './routeMeta';

const RouteSkeletonChromeContext = createContext<RouteSkeletonChrome>('page');

/**
 * A route fallback renders inside whatever layout has already mounted, so it
 * cannot know on its own whether it stands in for the whole surface or only for
 * the outlet. A layout that draws its own chrome declares `body` around its
 * `Outlet`, and the skeleton drops the header it would otherwise duplicate.
 */
export const RouteSkeletonChromeProvider = ({
  children,
  value = 'body',
}: {
  children: ReactNode;
  value?: RouteSkeletonChrome;
}) => <RouteSkeletonChromeContext value={value}>{children}</RouteSkeletonChromeContext>;

export const useRouteSkeletonChrome = () => use(RouteSkeletonChromeContext);
