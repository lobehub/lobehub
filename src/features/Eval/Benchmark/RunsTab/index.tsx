'use client';

import { Flexbox } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { runSelectors, useEvalStore } from '@/store/eval';

import { createRunCreateModal } from '../RunCreateModal';
import { createRunEditModal } from '../RunEditModal';
import EmptyState from './EmptyState';
import { groupRuns } from './groupRuns';
import RunGroup from './RunGroup';
import RunsSkeleton from './RunsSkeleton';

const styles = createStaticStyles(({ css }) => ({
  count: css`
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  filterEmpty: css`
    padding-block: 32px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
}));

type StatusFilter = 'aborted' | 'active' | 'all' | 'completed' | 'failed' | 'idle';

interface RunsTabProps {
  benchmarkId: string;
}

const RunsTab = ({ benchmarkId }: RunsTabProps) => {
  const { t } = useTranslation('eval');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const useFetchRuns = useEvalStore((s) => s.useFetchRuns);
  const runList = useEvalStore(runSelectors.runList);
  const refreshRuns = useEvalStore((s) => s.refreshRuns);
  const { data, error, isLoading, mutate } = useFetchRuns(benchmarkId);

  const groups = useMemo(() => {
    const filtered =
      statusFilter === 'all'
        ? runList
        : statusFilter === 'active'
          ? runList.filter((r) => r.status === 'running' || r.status === 'pending')
          : runList.filter((r) => r.status === statusFilter);
    return groupRuns(filtered);
  }, [runList, statusFilter]);

  const statusOptions = [
    { label: t('table.filter.all'), value: 'all' },
    { label: t('run.status.completed'), value: 'completed' },
    { label: t('run.filter.active'), value: 'active' },
    { label: t('run.status.idle'), value: 'idle' },
    { label: t('run.status.failed'), value: 'failed' },
    { label: t('run.status.aborted'), value: 'aborted' },
  ];

  return (
    <AsyncBoundary
      data={data}
      empty={<EmptyState onCreate={() => createRunCreateModal({ benchmarkId })} />}
      error={error}
      isEmpty={!error && runList.length === 0}
      isLoading={isLoading && runList.length === 0}
      loading={<RunsSkeleton />}
      onRetry={() => void mutate()}
    >
      <Flexbox gap={16}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <span className={styles.count}>
            {t('benchmark.runs.summary', { groups: groups.length, runs: runList.length })}
          </span>
          <Select
            options={statusOptions}
            size="small"
            style={{ width: 128 }}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
          />
        </Flexbox>
        {groups.length === 0 ? (
          <div className={styles.filterEmpty}>{t('run.filter.empty')}</div>
        ) : (
          groups.map((group) => (
            <RunGroup
              benchmarkId={benchmarkId}
              group={group}
              key={group.key}
              onEdit={(run) => createRunEditModal({ run })}
              onRefresh={() => refreshRuns(benchmarkId)}
            />
          ))
        )}
      </Flexbox>
    </AsyncBoundary>
  );
};

export default RunsTab;
