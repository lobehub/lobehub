'use client';

import Empty from '@lobehub/ui/es/Empty/index';
import { Center, Flexbox } from '@lobehub/ui/es/Flex/index';
import Icon from '@lobehub/ui/es/Icon/index';
import Text from '@lobehub/ui/es/Text/index';
import { createStaticStyles, cssVar } from 'antd-style';
import { ClipboardCheck, Search, TriangleAlert } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { WorkbenchHeader } from '../../shell/WorkbenchHeader';
import VerifyRow from './VerifyRow';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: hidden auto;
    flex: 1;
    min-height: 0;
  `,
  emptyState: css`
    min-height: 280px;
    padding-block: 24px;
    padding-inline: 16px;
  `,
  header: css`
    flex: none;
    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    padding-block: 8px 24px;
    padding-inline: 8px;
  `,
  page: css`
    width: 100%;
    height: 100dvh;
    background: ${cssVar.colorBgLayout};
  `,
  retry: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  search: css`
    display: flex;
    gap: 8px;
    align-items: center;

    height: 36px;
    padding-inline: 11px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    input {
      width: 100%;
      min-width: 0;
      border: 0;

      color: ${cssVar.colorText};

      background: transparent;
      outline: none;
    }
  `,
  searchEmpty: css`
    padding-block: 28px;
    padding-inline: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  skeleton: css`
    height: 52px;
    margin-block: 2px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillTertiary};
  `,
  skeletonList: css`
    padding-block: 8px;
    padding-inline: 8px;
  `,
}));

const WorkbenchVerifyList = memo(() => {
  const { t } = useTranslation('verify');
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();
  const { data, error, isLoading, mutate } = useSWR(
    verifyKeys.reportSummaries(undefined, trimmedQuery),
    () =>
      verifyService.listReportSummaries({
        limit: 50,
        q: trimmedQuery || undefined,
      }),
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
  const items = data?.items ?? [];

  return (
    <Flexbox className={styles.page}>
      <Flexbox className={styles.header} gap={12}>
        <WorkbenchHeader>
          <Text strong style={{ fontSize: 17 }}>
            {t('workspace.title')}
          </Text>
        </WorkbenchHeader>
        <label className={styles.search}>
          <Icon color={cssVar.colorTextQuaternary} icon={Search} size={15} />
          <input
            placeholder={t('workspace.search')}
            type={'search'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </Flexbox>

      <div className={styles.content}>
        {error ? (
          <Center className={styles.emptyState} gap={12}>
            <Empty
              description={t('workspace.loadError')}
              icon={TriangleAlert}
              title={t('workspace.loadErrorTitle')}
            />
            <button className={styles.retry} type={'button'} onClick={() => void mutate()}>
              {t('workspace.retry')}
            </button>
          </Center>
        ) : isLoading ? (
          <div className={styles.skeletonList}>
            {Array.from({ length: 8 }).map((_, index) => (
              <div className={styles.skeleton} key={index} />
            ))}
          </div>
        ) : items.length === 0 ? (
          trimmedQuery ? (
            <Flexbox className={styles.searchEmpty} gap={12}>
              <span>
                {t('workspace.searchEmptyPrefix')}
                {trimmedQuery}
                {t('workspace.searchEmptySuffix')}
              </span>
              <button className={styles.retry} type={'button'} onClick={() => setQuery('')}>
                {t('workspace.clearSearch')}
              </button>
            </Flexbox>
          ) : (
            <Center className={styles.emptyState}>
              <Empty
                description={t('workspace.listEmpty')}
                icon={ClipboardCheck}
                title={t('workspace.listEmptyTitle')}
              />
            </Center>
          )
        ) : (
          <div className={styles.list}>
            {items.map((item) => (
              <VerifyRow item={item} key={item.run.id} />
            ))}
          </div>
        )}
      </div>
    </Flexbox>
  );
});

WorkbenchVerifyList.displayName = 'WorkbenchVerifyList';

export default WorkbenchVerifyList;
