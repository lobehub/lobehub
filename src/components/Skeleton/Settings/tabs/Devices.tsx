'use client';

import { Flexbox } from '@lobehub/ui';

import { DeviceDetailSkeleton, DeviceGridSkeleton } from '@/features/DeviceManager/Skeleton';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton, SettingsTabSkeletonProps } from './types';

/**
 * `/settings/devices` is the card grid (the personal pool has no visibility
 * tabs, so its refresh + connect actions sit in the settings header);
 * `/settings/devices/:id` is one device's detail page. Both reuse the skeletons
 * `DeviceManager` and `DeviceDetailPage` show while their data loads.
 */
const Body = ({ sub }: SettingsTabSkeletonProps) =>
  sub ? <DeviceDetailSkeleton /> : <DeviceGridSkeleton />;

/** Small refresh + "Connect device" buttons, list page only. */
const PageActions = ({ sub }: SettingsTabSkeletonProps) =>
  sub ? null : (
    <Flexbox horizontal align={'center'} gap={8}>
      <SkeletonBar height={32} width={32} />
      <SkeletonBar height={32} width={112} />
    </Flexbox>
  );

const DevicesSkeleton: SettingsTabSkeleton = { Body, PageActions };

export default DevicesSkeleton;
