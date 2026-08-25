'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceWorksInfinite } from '@/features/WorkGallery/hooks';
import { useOpenWork } from '@/features/WorkGallery/useOpenWork';
import WorkPreviewCard from '@/features/WorkGallery/WorkPreviewCard';

import SectionTitle from './SectionTitle';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  `,
}));

/** The dashboard shows only the freshest works; the full gallery lives at /resource/works. */
const MAX_RECENT_WORKS = 3;

const RecentWorks = memo(() => {
  const { t } = useTranslation('file');
  const openWork = useOpenWork();

  const { error, items, isLoadingInitial, reload } = useWorkspaceWorksInfinite('all');
  const recent = items.slice(0, MAX_RECENT_WORKS);

  if (!isLoadingInitial && !error && recent.length === 0) return null;

  return (
    <Flexbox gap={12}>
      <SectionTitle title={t('work.group')} viewAllUrl={'/resource/works'} />
      {error && recent.length === 0 ? (
        <AsyncError error={error} variant={'inline'} onRetry={reload} />
      ) : isLoadingInitial ? (
        <div className={styles.grid}>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton.Node active key={index} style={{ height: 220, width: '100%' }} />
          ))}
        </div>
      ) : (
        <div className={styles.grid}>
          {recent.map((item) => (
            <WorkPreviewCard item={item} key={item.id} onOpen={openWork} />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

RecentWorks.displayName = 'RecentWorks';

export default RecentWorks;
