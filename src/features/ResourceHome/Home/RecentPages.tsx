'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import {
  RESOURCE_HOME_SECTIONS,
  ResourceSectionSkeleton,
} from '@/components/Skeleton/ResourceHome';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { getResourceQueryVisibility } from '@/features/ResourceManager/store/selectors';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { resourceKeys } from '@/libs/swr/keys';
import { fileService } from '@/services/file';

import SectionTitle from './SectionTitle';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    text-align: start;

    background: ${cssVar.colorBgContainer};

    transition: all 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorBorder};
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  emoji: css`
    font-size: 20px;
    line-height: 1;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  title: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const formatTime = (date: Date | string) =>
  dayjs().diff(dayjs(date), 'd') < 7 ? dayjs(date).fromNow() : dayjs(date).format('YYYY-MM-DD');

const RecentPages = memo(() => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const workspaceId = useActiveWorkspaceId();
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const visibility = workspaceId
    ? getResourceQueryVisibility(undefined, listVisibility)
    : undefined;

  const { data, error, isLoading, mutate } = useClientDataSWR(
    resourceKeys.recentPages(workspaceId ?? null, visibility),
    () => fileService.getRecentPages(6, visibility),
  );

  if (!isLoading && !error && !data?.length) return null;

  return (
    <Flexbox gap={12}>
      <SectionTitle title={t('home.recentPages')} viewAllUrl={'/resource/page'} />
      {error && !data?.length ? (
        <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
      ) : isLoading ? (
        <ResourceSectionSkeleton {...RESOURCE_HOME_SECTIONS.pages} />
      ) : (
        <div className={styles.grid}>
          {data?.map((item) => {
            const emoji = (item.metadata as { emoji?: string } | null)?.emoji;
            return (
              <button
                className={styles.card}
                key={item.id}
                type={'button'}
                onClick={() => navigate(`/resource?file=${item.id}`)}
              >
                {emoji ? (
                  <span className={styles.emoji}>{emoji}</span>
                ) : (
                  <Icon icon={FileTextIcon} size={20} />
                )}
                <Flexbox gap={2} style={{ minWidth: 0 }}>
                  <span className={styles.title}>{item.name}</span>
                  <span className={styles.meta}>{formatTime(item.updatedAt)}</span>
                </Flexbox>
              </button>
            );
          })}
        </div>
      )}
    </Flexbox>
  );
});

RecentPages.displayName = 'RecentPages';

export default RecentPages;
