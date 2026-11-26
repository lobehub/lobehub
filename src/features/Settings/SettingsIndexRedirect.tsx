'use client';

import { memo } from 'react';
import { Navigate } from 'react-router';

import { useCategory } from './hooks/useCategory';
import { getSettingsIndexUrl } from './settingsIndexUrl';

/**
 * `/settings` index: opens the personal space's own settings on its first tab
 * instead of the account set, the same way a workspace's `/:slug/settings`
 * opens Workspace › General. Account settings stay one click away on the
 * sidebar's bottom card.
 */
const SettingsIndexRedirect = memo(() => {
  const groups = useCategory();

  return <Navigate replace to={getSettingsIndexUrl(groups)} />;
});

SettingsIndexRedirect.displayName = 'SettingsIndexRedirect';

export default SettingsIndexRedirect;
