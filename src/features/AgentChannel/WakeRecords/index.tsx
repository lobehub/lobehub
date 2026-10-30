'use client';

import type { SignalDecisionOutcome } from '@lobechat/types';
import { Button, Empty, Flexbox, Segmented, Skeleton, Switch, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { History } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';

import { RecordTable } from './RecordTable';
import { Summary } from './Summary';
import { useWakeDecisions, type WakeRecordFilters } from './useWakeRecords';

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
  /** `agent_bot_providers.id` of a saved bot. */
  botId: string;
  /** The caller cannot write (a viewer, or a plan gate): marks are read-only. */
  disabled?: boolean;
}

/**
 * Every message the bot judged lately, what it did and why, and a one-click mark of whether that
 * was right. Read-only history: nothing here takes part in the settings form or its Save.
 */
export const WakeRecords = ({ botId, disabled }: WakeRecordsProps) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string, options?: Record<string, unknown>) => string;
  const [filters, setFilters] = useState<WakeRecordFilters>(NO_FILTERS);
  const { data, error, isLoading, isValidating, markDecision, mutate, setSize, size } =
    useWakeDecisions(botId, filters);

  const items = data?.flatMap((page) => page.items) ?? [];
  const filtered = filters.outcome || filters.followupOnly || filters.unmarkedOnly;
  const hasMore = !!data?.at(-1)?.nextCursor;
  // A next page was asked for and has not arrived (or failed) yet.
  const loadingMore = !!data && data.length < size;
  const loadMoreFailed = loadingMore && !!error && !isValidating;

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
      </Flexbox>
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={items.length === 0}
        isLoading={isLoading}
        loading={<ListSkeleton />}
        empty={
          filtered ? (
            <Empty
              title={t('channel.records.emptyFiltered.title')}
              action={
                <Button size={'small'} onClick={() => setFilters(NO_FILTERS)}>
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
        <RecordTable disabled={disabled} items={items} onMark={markDecision} />
        {loadMoreFailed ? (
          <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
        ) : hasMore || loadingMore ? (
          <Flexbox horizontal justify={'center'}>
            <Button loading={loadingMore} onClick={() => void setSize(size + 1)}>
              {t('channel.records.loadMore')}
            </Button>
          </Flexbox>
        ) : (
          items.length > 0 && (
            <Text align={'center'} fontSize={12} type={'secondary'}>
              {t('channel.records.end', { days: WINDOW_DAYS })}
            </Text>
          )
        )}
      </AsyncBoundary>
    </Flexbox>
  );
};
