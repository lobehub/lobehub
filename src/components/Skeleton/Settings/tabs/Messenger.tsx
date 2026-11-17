'use client';

import { MessengerListSkeleton, MessengerPlatformDetailSkeleton } from '../MessengerDetail';
import type { SettingsTabSkeleton, SettingsTabSkeletonProps } from './types';

/** `/settings/messenger` lists the platforms; `/settings/messenger/:platform` is one platform. */
const Body = ({ sub }: SettingsTabSkeletonProps) =>
  sub ? <MessengerPlatformDetailSkeleton platform={sub} /> : <MessengerListSkeleton />;

const MessengerSkeleton: SettingsTabSkeleton = { Body };

export default MessengerSkeleton;
