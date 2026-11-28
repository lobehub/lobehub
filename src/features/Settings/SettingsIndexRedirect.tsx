'use client';

import { memo } from 'react';
import { Navigate } from 'react-router';

import SettingsPageSkeleton from '@/components/Skeleton/Settings/Page';

import { useSettingsIndexUrl } from './hooks/useSettingsIndexUrl';

/**
 * `/settings` index: opens the personal space's own settings on its first tab
 * instead of the account set, the same way a workspace's `/:slug/settings`
 * opens Workspace › General. Account settings stay one click away on the
 * sidebar's bottom card.
 */
const SettingsIndexRedirect = memo(() => {
  const destination = useSettingsIndexUrl();

  // Until the server config lands, keep the same skeleton the route's chunk
  // fallback showed, so the pane never goes blank between the two.
  if (!destination) return <SettingsPageSkeleton />;

  return <Navigate replace to={destination} />;
});

SettingsIndexRedirect.displayName = 'SettingsIndexRedirect';

export default SettingsIndexRedirect;
