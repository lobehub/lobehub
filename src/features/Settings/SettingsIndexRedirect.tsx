'use client';

import { memo } from 'react';
import { Navigate } from 'react-router';

import { useSettingsIndexUrl } from './hooks/useSettingsIndexUrl';

/**
 * `/settings` index: opens the personal space's own settings on its first tab
 * instead of the account set, the same way a workspace's `/:slug/settings`
 * opens Workspace › General. Account settings stay one click away on the
 * sidebar's bottom card.
 */
const SettingsIndexRedirect = memo(() => {
  const destination = useSettingsIndexUrl();

  return destination ? <Navigate replace to={destination} /> : null;
});

SettingsIndexRedirect.displayName = 'SettingsIndexRedirect';

export default SettingsIndexRedirect;
