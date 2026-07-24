'use client';

import { useCallback } from 'react';
import { type NavigateOptions, type To } from 'react-router';

import {
  navigateActiveTab,
  navigateActiveTabByDelta,
} from '@/features/Electron/navigation/activeTabNavigate';
import { appNavigate } from '@/features/Electron/navigation/appNavigate';

import type { WorkspaceAwareNavigateFunction } from './useWorkspaceAwareNavigate';
import type { WorkspaceAwareNavigateOptions } from './workspaceAwarePath';

export type { WorkspaceAwareNavigateOptions } from './workspaceAwarePath';

// The desktop shell (sidebars, titlebar, cmdk) renders outside the per-tab
// routers, so its `useNavigate` targets the frozen root router. Route every
// workspace-aware navigation into the active tab's memory router instead.
export const useWorkspaceAwareNavigate = (): WorkspaceAwareNavigateFunction =>
  useCallback(
    ((to: To | number, options?: WorkspaceAwareNavigateOptions) => {
      if (typeof to === 'number') return navigateActiveTabByDelta(to);
      if (typeof to !== 'string') return navigateActiveTab(to, options as NavigateOptions);
      return appNavigate(to, options);
    }) as WorkspaceAwareNavigateFunction,
    [],
  );
