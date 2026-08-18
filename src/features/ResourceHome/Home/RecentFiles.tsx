'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import FileIcon from '@/components/FileIcon';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { getResourceQueryVisibility } from '@/features/ResourceManager/store/selectors';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { resourceKeys } from '@/libs/swr/keys';
import { fileService } from '@/services/file';
import { FilesTabs } from '@/types/files';

import SectionTitle from './SectionTitle';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    padding: 0;
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
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  name: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  preview: css`
    display: flex;
    align-items: center;
    justify-content: center;

    aspect-ratio: 16 / 10;
    width: 100%;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  thumbnail: css`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,
}));

const formatTime = (date: Date | string) =>
  dayjs().diff(dayjs(date), 'd') < 7 ? dayjs(date).fromNow() : dayjs(date).format('YYYY-MM-DD');

const RecentFiles = memo(() => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const workspaceId = useActiveWorkspaceId();
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const visibility = workspaceId
    ? getResourceQueryVisibility(undefined, listVisibility)
    : undefined;

  const { data, error, isLoading, mutate } = useClientDataSWR(
    resourceKeys.recentFiles(workspaceId ?? null, visibility),
    () => fileService.getRecentFiles(8, visibility),
  );

  if (!isLoading && !error && !data?.length) return null;

  return (
    <Flexbox gap={12}>
      <SectionTitle title={t('home.recentFiles')} viewAllUrl={`/resource/${FilesTabs.All}`} />
      {error && !data?.length ? (
        <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
      ) : isLoading ? (
        <div className={styles.grid}>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton.Node active key={index} style={{ height: 160, width: '100%' }} />
          ))}
        </div>
      ) : (
        <div className={styles.grid}>
          {data?.map((item) => {
            const isImage = item.fileType?.startsWith('image');
            return (
              <button
                className={styles.card}
                key={item.id}
                type={'button'}
                onClick={() => navigate(`/resource?file=${item.id}`)}
              >
                <div className={styles.preview}>
                  {isImage && item.url ? (
                    <img alt={item.name} className={styles.thumbnail} src={item.url} />
                  ) : (
                    <FileIcon fileName={item.name} fileType={item.fileType} size={40} />
                  )}
                </div>
                <Flexbox gap={4} padding={12}>
                  <span className={styles.name}>{item.name}</span>
                  <span className={styles.meta}>{formatTime(item.createdAt)}</span>
                </Flexbox>
              </button>
            );
          })}
        </div>
      )}
    </Flexbox>
  );
});

RecentFiles.displayName = 'RecentFiles';

export default RecentFiles;
