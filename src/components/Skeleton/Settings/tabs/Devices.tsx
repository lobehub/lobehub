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
const HeaderRight = ({ sub }: SettingsTabSkeletonProps) =>
  sub ? null : (
    <Flexbox horizontal align={'center'} gap={8}>
      <SkeletonBar height={28} width={28} />
      <SkeletonBar height={28} width={104} />
    </Flexbox>
  );

const DevicesSkeleton: SettingsTabSkeleton = { Body, HeaderRight };

export default DevicesSkeleton;
