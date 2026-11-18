'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import {
  IntegrationDetailSkeleton,
  IntegrationsOverviewSkeleton,
} from '@/features/Integrations/Skeleton';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton, SettingsTabSkeletonProps } from './types';

/**
 * The directory: the intro line (static copy) above the overview, 20px apart —
 * the page body under the shared header, filling the settings column.
 * An integration page (`:sub`) draws its own hero instead of the intro.
 */
const Body = ({ sub }: SettingsTabSkeletonProps) => {
  const { t, ready } = useTranslation('integration');

  if (sub) return <IntegrationDetailSkeleton />;

  return (
    <Flexbox gap={20}>
      {ready ? (
        <Text type={'secondary'}>{t('overview.description')}</Text>
      ) : (
        <SkeletonBar height={14} width={360} />
      )}
      <IntegrationsOverviewSkeleton />
    </Flexbox>
  );
};

const IntegrationsSkeleton: SettingsTabSkeleton = { Body };

export default IntegrationsSkeleton;
