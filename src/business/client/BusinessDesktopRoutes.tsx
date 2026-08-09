'use client';

import { type RouteObject } from 'react-router';

import { dynamicElement, ErrorBoundary } from '@/utils/router';

/**
 * Aico personal billing / org surfaces.
 * Platform admin lives on `@aico/control-plane` — not in the customer SPA.
 * Personal-only — never mirrored under `/:workspaceSlug`.
 */
export const BusinessDesktopRoutesWithMainLayout: RouteObject[] = [
  {
    element: dynamicElement(() => import('@/routes/(main)/wallet'), 'Desktop > Wallet'),
    errorElement: <ErrorBoundary />,
    path: 'wallet',
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/org'), 'Desktop > Org'),
    errorElement: <ErrorBoundary />,
    path: 'org',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/org/[orgId]/members'),
      'Desktop > Org > Members',
    ),
    errorElement: <ErrorBoundary />,
    path: 'org/:orgId/members',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/invite/[token]'),
      'Desktop > Invite Accept',
    ),
    errorElement: <ErrorBoundary />,
    path: 'invite/:token',
  },
];

export const BusinessDesktopRoutesWithSettingsLayout: RouteObject[] = [];
export const BusinessDesktopRoutesWithoutMainLayout: RouteObject[] = [];
export const BusinessResourceRoutes: RouteObject[] = [];
