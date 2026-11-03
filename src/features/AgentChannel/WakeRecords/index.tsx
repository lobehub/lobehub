'use client';

import type { SignalDecisionOutcome } from '@lobechat/types';
import { ActionIcon, Button, Empty, Flexbox, Segmented, Skeleton, Switch, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { History, RotateCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { mutate as mutateGlobal } from '@/libs/swr';
import { botWakeKeys } from '@/libs/swr/keys';

import { RecordTable } from './RecordTable';
import { Summary } from './Summary';
import { useRefreshOnReturn } from './useRefreshOnReturn';
import {
  pageLoadFailed,
  recordsEmpty,
  useWakeDecisions,
  WAKE_RECORDS_PAGE_SIZE,
  type WakeRecordFilters,
} from './useWakeRecords';

/** Matches `SCOPE_READ_DEFAULT_DAYS` on the server; the summary reports it too. */
const WINDOW_DAYS = 30;

const OUTCOMES = ['wake', 'skip', 'defer'] as const;
const ALL = 'all';

const NO_FILTERS: WakeRecordFilters = { followupOnly: false, unmarkedOnly: false };

const styles = stylex.create({
  list: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
});

const ListSkeleton = () => (
  <Flexbox {...stylex.props(styles.list)}>
    {Array.from({ length: 4 }, (_, i) => (
      <Flexbox gap={8} key={i} padding={16}>
        <Skeleton height={20} width={160} />
        <Skeleton.Text rows={2} />
      </Flexbox>
    ))}
  </Flexbox>
);

interface WakeRecordsProps {
  /** The tab is showing. The panel stays mounted while hidden; showing it again refetches. */
  active?: boolean;
  /** `agent_bot_providers.id` of a saved bot. */
  botId: string;
  /** The caller cannot write (a viewer, or a plan gate): marks are read-only. */
  disabled?: boolean;
}

/**
 * Every message the bot judged lately, what it did and why, and a one-click mark of whether that
 * was right. Read-only history: nothing here takes part in the settings form or its Save.
 */
export const WakeRecords = ({ active = true, botId, disabled }: WakeRecordsProps) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string, options?: Record<string, unknown>) => string;
  const [filters, setFiltersState] = useState<WakeRecordFilters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const { data, error, isLoading, isValidating, markDecision, mutate } = useWakeDecisions(
    botId,
    filters,
    page,
  );

  // Another filter is another list: start it from its first page.
  const setFilters = useCallback((update: (prev: WakeRecordFilters) => WakeRecordFilters) => {
    setFiltersState(update);
    setPage(1);
  }, []);

  // New decisions arrive while the owner is elsewhere (testing the bot): refetch the open page
  // and the summary on coming back, and on demand.
  const refresh = useCallback(() => {
    void mutate();
    void mutateGlobal(botWakeKeys.summary(botId));
  }, [botId, mutate]);
  useRefreshOnReturn(active, refresh);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const filtered = filters.outcome || filters.followupOnly || filters.unmarkedOnly;

  return (
    <Flexbox gap={16}>
      <Text fontSize={12} type={'secondary'}>
        {t('channel.records.intro', { days: WINDOW_DAYS })}
      </Text>
      <Summary botId={botId} />
      <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
        <Segmented
          size={'small'}
          value={filters.outcome ?? ALL}
          options={[
            { label: t('channel.records.filter.all'), value: ALL },
            ...OUTCOMES.map((outcome) => ({
              label: t(`channel.records.outcome.${outcome}`),
              value: outcome,
            })),
          ]}
          onChange={(value) =>
            setFilters((prev) => ({
              ...prev,
              outcome: value === ALL ? undefined : (value as SignalDecisionOutcome),
            }))
          }
        />
        <Flexbox horizontal align={'center'} gap={8}>
          <Switch
            checked={filters.followupOnly}
            size={'small'}
            onChange={(checked) => setFilters((prev) => ({ ...prev, followupOnly: checked }))}
          />
          <Text>{t('channel.records.filter.followupOnly')}</Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <Switch
            checked={filters.unmarkedOnly}
            size={'small'}
            onChange={(checked) => setFilters((prev) => ({ ...prev, unmarkedOnly: checked }))}
          />
          <Text>{t('channel.records.filter.unmarkedOnly')}</Text>
        </Flexbox>
        <ActionIcon
          aria-label={t('channel.records.refresh')}
          icon={RotateCw}
          loading={isValidating && !isLoading}
          size={'small'}
          style={{ marginInlineStart: 'auto' }}
          title={t('channel.records.refresh')}
          onClick={refresh}
        />
      </Flexbox>
      <AsyncBoundary
        data={data}
        error={error}
        // A page past the end (its last rows marked away) is not an empty list: the pager stays.
        isEmpty={recordsEmpty({ error, total })}
        // A page turn keeps the previous page on screen; only the first load is a skeleton.
        isLoading={isLoading && !data}
        loading={<ListSkeleton />}
        empty={
          filtered ? (
            <Empty
              title={t('channel.records.emptyFiltered.title')}
              action={
                <Button onClick={() => setFilters(() => NO_FILTERS)}>
                  {t('channel.records.emptyFiltered.clear')}
                </Button>
              }
            />
          ) : (
            <Empty
              description={t('channel.records.empty.desc')}
              icon={History}
              title={t('channel.records.empty.title')}
            />
          )
        }
        onRetry={() => void mutate()}
      >
        {pageLoadFailed({ data, error, isLoading }) && (
          <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
        )}
        <RecordTable
          disabled={disabled}
          items={items}
          // The previous page, while the one asked for loads.
          loading={isLoading}
          pagination={{
            current: page,
            onChange: setPage,
            pageSize: WAKE_RECORDS_PAGE_SIZE,
            total,
          }}
          onMark={markDecision}
        />
      </AsyncBoundary>
    </Flexbox>
  );
};
