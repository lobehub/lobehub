'use client';

import { SettingsFormSkeleton, SWITCH_CONTROL } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** One filled group: the enable switch and the effort slider (~180x44 with its marks). */
const Body = () => {
  const text = useSkeletonText('setting');

  return (
    <SettingsFormSkeleton
      groups={[
        {
          items: [
            {
              control: SWITCH_CONTROL,
              desc: text('memory.enabled.desc', 240, 12),
              label: text('memory.enabled.title', 96, 14),
              layout: 'horizontal',
              minWidth: undefined,
            },
            {
              control: { height: 44, width: 180 },
              desc: text('memory.effort.desc', 240, 12),
              label: text('memory.effort.title', 96, 14),
              layout: 'horizontal',
              minWidth: undefined,
            },
          ],
          title: text('memory.title', 80, 16),
        },
      ]}
    />
  );
};

const MemorySkeleton: SettingsTabSkeleton = { Body };

export default MemorySkeleton;
