'use client';

import { type RouteObject } from 'react-router';

import { dynamicElement, ErrorBoundary, redirectElement } from '@/utils/router';

/**
 * Aico personal billing / org / platform-admin surfaces.
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
  {
    element: dynamicElement(() => import('@/routes/(main)/platform'), 'Desktop > Platform Admin'),
    errorElement: <ErrorBoundary />,
    path: 'platform',
  },
  {
    element: redirectElement('/platform'),
    path: 'panel',
  },
];

export const BusinessDesktopRoutesWithSettingsLayout: RouteObject[] = [];
export const BusinessDesktopRoutesWithoutMainLayout: RouteObject[] = [];
export const BusinessResourceRoutes: RouteObject[] = [];
