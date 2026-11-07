'use client';

import AppDetailSkeleton from '@/features/Settings/oauth-apps/features/AppDetailSkeleton';
import AppListSkeleton from '@/features/Settings/oauth-apps/features/AppListSkeleton';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton, SettingsTabSkeletonProps } from './types';

/** The list is one bordered card of app rows; `/settings/oauth-apps/:id` is one app's page. */
const Body = ({ sub }: SettingsTabSkeletonProps) =>
  sub ? <AppDetailSkeleton /> : <AppListSkeleton />;

/** The small "Create" button the list portals into the header; app pages have none. */
const PageActions = ({ sub }: SettingsTabSkeletonProps) =>
  sub ? null : <SkeletonBar height={32} width={112} />;

const OAuthAppsSkeleton: SettingsTabSkeleton = { Body, PageActions };

export default OAuthAppsSkeleton;
