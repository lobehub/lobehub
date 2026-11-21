'use client';

import { cssVar, Flexbox } from '@lobehub/ui';

import { useDensity, useDensityTokens } from '@/styles/density';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton } from './types';

const ROW_WIDTHS = [
  [120, 168],
  [96, 216],
  [144, 136],
  [112, 184],
];

interface CredsListSkeletonProps {
  rows?: number;
  /** Matches `CredItem`'s variant: `card` is the personal vault's filled rows. */
  variant?: 'card' | 'list';
}

/**
 * Credential rows as `CredItem` lays them out: a 48px icon tile, a name line
 * over a key line, and the "..." menu button. `list` rows sit edge to edge
 * with 12px block padding and a type tag; `card` rows are filled cards 8px
 * apart with 12px × 16px padding and no tag, like the personal vault.
 */
export const CredsListSkeleton = ({ rows = 4, variant = 'list' }: CredsListSkeletonProps) => {
  // Compact `CredItem`: 6px padding, 36px tile, 22px title line + 2 + 18px key line = 54px.
  const { compact, tokens } = useDensity();
  const { controlHeight } = useDensityTokens();
  const isCard = variant === 'card';

  return (
    <Flexbox aria-busy data-testid={'settings-creds-skeleton'} gap={isCard ? 8 : 0} width={'100%'}>
      {Array.from({ length: rows }, (_, index) => {
        const [title, key] = ROW_WIDTHS[index % ROW_WIDTHS.length];
        return (
          <Flexbox
            horizontal
            align={'center'}
            gap={tokens.sectionGap}
            justify={'space-between'}
            key={index}
            style={
              isCard
                ? {
                    background: cssVar.colorFillQuaternary,
                    borderRadius: cssVar.borderRadiusLG,
                    paddingBlock: 12,
                    paddingInline: 16,
                  }
                : { paddingBlock: compact ? 6 : 12 }
            }
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
                  {!isCard && <SkeletonBar height={22} radius={cssVar.borderRadiusSM} width={52} />}
                </Flexbox>
                <Flexbox height={18} justify={'center'}>
                  <SkeletonBar height={12} width={key} />
                </Flexbox>
              </Flexbox>
            </Flexbox>
            <SkeletonBar height={controlHeight} width={controlHeight} />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};

/**
 * The personal vault page: the toolbar row (category tabs, search, create
 * menu) above the card rows.
 */
const VaultSkeleton = () => (
  <Flexbox gap={16} width={'100%'}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <SkeletonBar height={38} radius={cssVar.borderRadiusLG} width={420} />
      <Flexbox horizontal align={'center'} gap={8}>
        <SkeletonBar height={32} width={220} />
        <SkeletonBar height={32} width={120} />
      </Flexbox>
    </Flexbox>
    <CredsListSkeleton variant={'card'} />
  </Flexbox>
);

const CredsSkeleton: SettingsTabSkeleton = { Body: VaultSkeleton };

export default CredsSkeleton;
