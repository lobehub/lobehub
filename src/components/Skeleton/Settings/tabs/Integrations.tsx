'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import {
  IntegrationDetailSkeleton,
  IntegrationsColumn,
  IntegrationsOverviewSkeleton,
} from '@/features/Integrations/Skeleton';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton, SettingsTabSkeletonProps } from './types';

/**
 * The directory: the intro line (static copy) above the overview, both in the
 * 760px reading column, 20px apart — the page body under the shared header.
 * An integration page (`:sub`) draws its own hero instead of the intro.
 */
const Body = ({ sub }: SettingsTabSkeletonProps) => {
  const { t, ready } = useTranslation('integration');

  if (sub)
    return (
      <IntegrationsColumn>
        <IntegrationDetailSkeleton />
      </IntegrationsColumn>
    );

  return (
    <Flexbox gap={20}>
      <IntegrationsColumn>
        {ready ? (
          <Text type={'secondary'}>{t('overview.description')}</Text>
        ) : (
          <SkeletonBar height={14} width={360} />
        )}
      </IntegrationsColumn>
      <IntegrationsColumn>
        <IntegrationsOverviewSkeleton />
      </IntegrationsColumn>
    </Flexbox>
  );
};

const IntegrationsSkeleton: SettingsTabSkeleton = { Body };

export default IntegrationsSkeleton;
