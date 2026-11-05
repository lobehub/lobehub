import { Button, Empty, Flexbox, Text } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SkeletonBar from '@/components/Skeleton/Bar';

import { SiteCard } from './SiteCard';
import { openSiteModal } from './SiteFormModal';
import { isForbidden, useProjectSites } from './useProjectReview';

export function SitesSettings({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const { data: sites, error, mutate } = useProjectSites(projectId);

  if (isForbidden(error)) return <Empty description={t('review.accessForbidden')} />;

  return (
    <Flexbox gap={20}>
      <Flexbox horizontal align="flex-start" gap={12} justify="space-between">
        <Flexbox gap={6}>
          <Text fontSize={16} weight={600}>
            {t('review.sites.title')}
          </Text>
          <Text type="secondary">{t('review.sites.description')}</Text>
        </Flexbox>
        <Button
          disabled={!sites}
          icon={PlusIcon}
          onClick={() => openSiteModal({ onSaved: () => mutate(), projectId })}
        >
          {t('review.sites.add')}
        </Button>
      </Flexbox>
      {error ? (
        <AsyncError error={error} onRetry={() => mutate()} />
      ) : !sites ? (
        <SkeletonBar height={160} radius={10} />
      ) : sites.length === 0 ? (
        <Empty description={t('review.sites.empty')} />
      ) : (
        sites.map((site) => <SiteCard key={site.id} site={site} onChanged={() => mutate()} />)
      )}
    </Flexbox>
  );
}
