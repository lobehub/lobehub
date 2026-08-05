'use client';

import type { DropdownItem } from '@lobehub/ui/base-ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import ActionIcon from '@lobehub/ui/es/ActionIcon/index';
import Empty from '@lobehub/ui/es/Empty/index';
import { Center, Flexbox } from '@lobehub/ui/es/Flex/index';
import Icon from '@lobehub/ui/es/Icon/index';
import Text from '@lobehub/ui/es/Text/index';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Check, ListFilter, ScrollText, Search, TriangleAlert } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import {
  type AcceptanceListFilter,
  DEFAULT_ACCEPTANCE_LIST_FILTER,
  filterAcceptanceList,
  normalizeAcceptanceListFilter,
} from '../Workspace/acceptanceListFilter';
import AcceptanceRow from './AcceptanceRow';

const ACCEPTANCE_LIST_FILTER_STORAGE_KEY = 'lobehub-acceptance-list-filter';
const EMPTY_FILTER_KEYS = {
  active: 'acceptance.workspace.filters.empty.active',
  completed: 'acceptance.workspace.filters.empty.completed',
} as const satisfies Record<Exclude<AcceptanceListFilter, 'all'>, string>;

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

const WorkbenchAcceptanceList = memo(() => {
  const { t } = useTranslation(['verify', 'common']);
  const { data, error, isLoading, mutate } = useSWR(
    verifyKeys.acceptances(),
    () => verifyService.listAcceptances(),
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
  const [query, setQuery] = useState('');
  const [storedFilter, setStoredFilter] = useLocalStorageState<AcceptanceListFilter>(
    ACCEPTANCE_LIST_FILTER_STORAGE_KEY,
    DEFAULT_ACCEPTANCE_LIST_FILTER,
  );
  const filter = normalizeAcceptanceListFilter(storedFilter);
  const filtered = filterAcceptanceList(data ?? [], filter, query);
  const trimmedQuery = query.trim();

  const filterItems: DropdownItem[] = (
    [
      ['active', t('acceptance.workspace.filters.active')],
      ['all', t('acceptance.workspace.filters.all')],
      ['completed', t('acceptance.workspace.filters.completed')],
    ] as const
  ).map(([key, label]) => ({
    icon: <Icon icon={Check} style={{ opacity: filter === key ? 1 : 0 }} />,
    key,
    label,
    onClick: () => setStoredFilter(key),
  }));

  return (
    <Flexbox className={styles.page}>
      <Flexbox className={styles.header} gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <ActionIcon
            icon={ArrowLeft}
            title={t('back', { ns: 'common' })}
            onClick={() => window.location.assign('/')}
          />
          <Text strong style={{ flex: 1, fontSize: 17 }}>
            {t('acceptance.workspace.title')}
          </Text>
          <DropdownMenu items={filterItems} placement={'bottomRight'}>
            <ActionIcon
              active={filter !== 'all'}
              icon={ListFilter}
              title={t('acceptance.workspace.filters.title')}
            />
          </DropdownMenu>
        </Flexbox>
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
        ) : filtered.length === 0 ? (
          trimmedQuery || filter !== 'all' ? (
            <Flexbox className={styles.searchEmpty} gap={12}>
              <span>
                {trimmedQuery
                  ? t('acceptance.workspace.filters.noSearchResults', { query: trimmedQuery })
                  : filter === 'all'
                    ? null
                    : t(EMPTY_FILTER_KEYS[filter])}
              </span>
              <button
                className={styles.retry}
                type={'button'}
                onClick={() => {
                  setQuery('');
                  setStoredFilter('all');
                }}
              >
                {t('acceptance.workspace.filters.showAll')}
              </button>
            </Flexbox>
          ) : (
            <Center className={styles.emptyState}>
              <Empty
                description={t('acceptance.workspace.listEmpty')}
                icon={ScrollText}
                title={t('acceptance.workspace.listEmptyTitle')}
              />
            </Center>
          )
        ) : (
          <div className={styles.list}>
            {filtered.map((item) => (
              <AcceptanceRow item={item} key={item.id} onChanged={mutate} />
            ))}
          </div>
        )}
      </div>
    </Flexbox>
  );
});

WorkbenchAcceptanceList.displayName = 'WorkbenchAcceptanceList';

export default WorkbenchAcceptanceList;
