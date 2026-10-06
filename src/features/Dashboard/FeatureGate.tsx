'use client';

import { memo, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';

import { useDashboardFeature } from './hooks/useDashboardFeature';

/**
 * Layout for the dashboard routes (home and project): renders them only while
 * the `dashboard` feature flag is on, otherwise leaves for the parent page
 * (home, or the project) so a stale link or bookmark lands somewhere useful.
 */
export const DashboardRouteGate = memo(() => {
  const { enabled, ready } = useDashboardFeature();
  if (!ready) return null;
  if (!enabled) return <Navigate replace to={'..'} />;
  return <Outlet />;
});

DashboardRouteGate.displayName = 'DashboardRouteGate';

/** Renders its children only while the `dashboard` feature flag is on. */
export const DashboardFeatureGate = memo<{ children: ReactNode }>(({ children }) => {
  const { enabled } = useDashboardFeature();
  return enabled ? children : null;
});

DashboardFeatureGate.displayName = 'DashboardFeatureGate';

export default DashboardRouteGate;
