'use client';

import { cssVar, Flexbox } from '@lobehub/ui';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton } from './types';

const ROW_WIDTHS = [
  [120, 168],
  [96, 216],
  [144, 136],
  [112, 184],
];

/**
 * Credential rows as `CredItem` lays them out: 12px block padding, a 48px icon
 * tile, a name + type-tag line over a key line, and the "..." menu button. Rows
 * sit edge to edge (gap 0), like the settled list.
 */
export const CredsListSkeleton = ({ rows = 4 }: { rows?: number }) => (
  <Flexbox aria-busy data-testid={'settings-creds-skeleton'} gap={0} width={'100%'}>
    {Array.from({ length: rows }, (_, index) => {
      const [title, key] = ROW_WIDTHS[index % ROW_WIDTHS.length];
      return (
        <Flexbox
          horizontal
          align={'center'}
          gap={16}
          justify={'space-between'}
          key={index}
          style={{ paddingBlock: 12 }}
        >
          <Flexbox horizontal align={'center'} flex={1} gap={16}>
            <SkeletonBar height={48} radius={12} width={48} />
            <Flexbox gap={4}>
              <Flexbox horizontal align={'center'} gap={8} height={22}>
                <SkeletonBar height={15} width={title} />
                <SkeletonBar height={22} radius={cssVar.borderRadiusSM} width={52} />
              </Flexbox>
              <Flexbox height={18} justify={'center'}>
                <SkeletonBar height={12} width={key} />
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <SkeletonBar height={32} width={32} />
        </Flexbox>
      );
    })}
  </Flexbox>
);

/** The small primary "Create" button the page portals into the header. */
const PageActions = () => <SkeletonBar height={32} width={96} />;

const CredsSkeleton: SettingsTabSkeleton = { Body: () => <CredsListSkeleton />, PageActions };

export default CredsSkeleton;
