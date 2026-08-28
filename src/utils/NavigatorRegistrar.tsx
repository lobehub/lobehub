'use client';

import { memo, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router';

import { useGlobalStore } from '@/store/global';
import { createNavigationRef } from '@/store/global/initialState';

// Syncs React Router's `navigate` into `navigationRef` so imperative navigation
// (see `getStableNavigate` / `useStableNavigate`) works outside the React tree.
export const NavigatorRegistrar = memo(() => {
  const navigate = useNavigate();

  useLayoutEffect(() => {
    useGlobalStore.setState({ navigationRef: { current: navigate } });
    return () => {
      useGlobalStore.setState({ navigationRef: createNavigationRef() });
    };
  }, [navigate]);

  return null;
});

NavigatorRegistrar.displayName = 'NavigatorRegistrar';
