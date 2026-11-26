'use client';

import { cssVar, Flexbox } from '@lobehub/ui';

import { useDensity } from '@/styles/density';

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
 * tile and a name + type-tag line over a key line. Rows sit edge to edge
 * (gap 0), like the settled list.
 */
export const CredsListSkeleton = ({ rows = 4 }: { rows?: number }) => {
  // Compact `CredItem`: 6px padding, 36px tile, 22px title line + 2 + 18px key line = 54px.
  const { compact, tokens } = useDensity();

  return (
    <Flexbox aria-busy data-testid={'settings-creds-skeleton'} gap={0} width={'100%'}>
      {Array.from({ length: rows }, (_, index) => {
        const [title, key] = ROW_WIDTHS[index % ROW_WIDTHS.length];
        return (
          <Flexbox
            horizontal
            align={'center'}
            gap={tokens.sectionGap}
            justify={'space-between'}
            key={index}
            style={{ paddingBlock: compact ? 6 : 12 }}
          >
            <Flexbox horizontal align={'center'} flex={1} gap={tokens.sectionGap}>
              <SkeletonBar
                height={tokens.listRowHeight}
                radius={compact ? 10 : 12}
                width={tokens.listRowHeight}
              />
              <Flexbox gap={compact ? 2 : 4}>
                <Flexbox horizontal align={'center'} gap={8} height={22}>
                  <SkeletonBar height={compact ? 14 : 15} width={title} />
                  <SkeletonBar height={22} radius={cssVar.borderRadiusSM} width={52} />
                </Flexbox>
                <Flexbox height={18} justify={'center'}>
                  <SkeletonBar height={12} width={key} />
                </Flexbox>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};

/** The small primary "Add" button the page portals into the header. */
const PageActions = () => <SkeletonBar height={32} width={72} />;

const CredsSkeleton: SettingsTabSkeleton = { Body: () => <CredsListSkeleton />, PageActions };

export default CredsSkeleton;
