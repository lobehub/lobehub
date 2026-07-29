'use client';

import { memo, useLayoutEffect } from 'react';
import { type NavigateFunction, type NavigateOptions, type To } from 'react-router';

import {
  navigateActiveTab,
  navigateActiveTabByDelta,
} from '@/features/Electron/navigation/activeTabNavigate';
import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import { useGlobalStore } from '@/store/global';
import { createNavigationRef } from '@/store/global/initialState';

// The root router is frozen on desktop, so point the global navigate ref at the
// active tab. Global-ref callers (`stableWorkspaceAwareNavigate`,
// `useStableNavigate`) resolve their own paths, so pass `escape` to route
// through `appNavigate` without re-applying the workspace prefix.
const activeTabNavigate: NavigateFunction = ((to: To | number, options?: NavigateOptions) => {
  if (typeof to === 'number') return navigateActiveTabByDelta(to);
  if (typeof to !== 'string') return navigateActiveTab(to, options);
  return appNavigate(to, { ...options, escape: true });
}) as NavigateFunction;

export const NavigatorRegistrar = memo(() => {
  useLayoutEffect(() => {
    useGlobalStore.setState({ navigationRef: { current: activeTabNavigate } });
    return () => {
      useGlobalStore.setState({ navigationRef: createNavigationRef() });
    };
  }, []);

  return null;
});

NavigatorRegistrar.displayName = 'NavigatorRegistrar';
