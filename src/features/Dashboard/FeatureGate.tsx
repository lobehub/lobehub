'use client';

import { memo, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';

import { useDashboardFeature, useHomeDashboardFeature } from './hooks/useDashboardFeature';

/**
 * Layout for the project dashboard routes: renders them only while
 * the `dashboard` feature flag is on, otherwise leaves for the parent page
 * (the project) so a stale link or bookmark lands somewhere useful.
 */
export const DashboardRouteGate = memo(() => {
  const { enabled, ready } = useDashboardFeature();
  if (!ready) return null;
  if (!enabled) return <Navigate replace to={'..'} />;
  return <Outlet />;
});

DashboardRouteGate.displayName = 'DashboardRouteGate';

/**
 * Layout for the home dashboard routes (`/dashboard`): like `DashboardRouteGate`,
 * but personal-only — inside a workspace it leaves for home too, so the board
 * list never lists or creates workspace-level boards.
 */
export const HomeDashboardRouteGate = memo(() => {
  const { enabled, ready } = useHomeDashboardFeature();
  if (!ready) return null;
  if (!enabled) return <Navigate replace to={'..'} />;
  return <Outlet />;
});

HomeDashboardRouteGate.displayName = 'HomeDashboardRouteGate';

/** Renders its children only while the `dashboard` feature flag is on. */
export const DashboardFeatureGate = memo<{ children: ReactNode }>(({ children }) => {
  const { enabled } = useDashboardFeature();
  return enabled ? children : null;
});

DashboardFeatureGate.displayName = 'DashboardFeatureGate';

export default DashboardRouteGate;
