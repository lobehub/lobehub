'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import ListSkeleton from '@/components/ListSkeleton';
import SkeletonBar from '@/components/Skeleton/Bar';

const styles = stylex.create({
  // Same frame as the manager's `listCol`.
  listCol: {
    overflow: 'hidden',
    minWidth: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
});

/**
 * The environment list while it loads: the bordered list frame with the same
 * 4px inset and 72px rows (`EnvironmentItem`, 2px apart) the loaded list uses.
 */
export const EnvironmentListSkeleton = () => (
  <Flexbox {...stylex.props(styles.listCol)}>
    <Flexbox padding={4}>
      <ListSkeleton />
    </Flexbox>
  </Flexbox>
);

/**
 * The detail panel's definition while only the stored row is known: the row
 * keeps no configuration, so its sections wait for the server's answer.
 */
export const EnvironmentDefinitionSkeleton = () => (
  <Flexbox aria-busy data-testid={'environment-definition-skeleton'} gap={12} paddingBlock={8}>
    <SkeletonBar height={16} width={'40%'} />
    <SkeletonBar height={32} width={'100%'} />
    <SkeletonBar height={16} width={'30%'} />
    <SkeletonBar height={32} width={'100%'} />
  </Flexbox>
);

/**
 * `EnvironmentManager` before its chunk loads: the heading row (pool tabs, or
 * the section name, then refresh + create) above the list frame. `leading`
 * replaces the section name, e.g. with a tab-strip placeholder.
 */
export const EnvironmentManagerSkeleton = ({ leading }: { leading?: ReactNode }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox aria-busy data-testid={'environments-skeleton'} gap={16}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        {leading ?? (
          <Text fontSize={16} weight={600}>
            {t('environments.mine')}
          </Text>
        )}
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={32} width={32} />
          <SkeletonBar height={32} width={128} />
        </Flexbox>
      </Flexbox>
      <EnvironmentListSkeleton />
    </Flexbox>
  );
};
