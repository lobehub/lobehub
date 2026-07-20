'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { runSelectors, useEvalStore } from '@/store/eval';

import { createRunCreateModal } from '../RunCreateModal';
import { createRunEditModal } from '../RunEditModal';
import EmptyState from './EmptyState';
import RunCard from './RunCard';

const styles = createStaticStyles(({ css }) => ({
  // Results-led run cards sit on a responsive grid; they collapse to a single
  // column on narrow viewports.
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
    gap: 12px;

    @media (width <= 640px) {
      grid-template-columns: 1fr;
    }
  `,
  filterEmpty: css`
    align-items: center;
    justify-content: center;

    padding-block: 48px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface RunsTabProps {
  benchmarkId: string;
}

const RunsTab = memo<RunsTabProps>(({ benchmarkId }) => {
  const { t } = useTranslation('eval');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const useFetchRuns = useEvalStore((s) => s.useFetchRuns);
  const runList = useEvalStore(runSelectors.runList);
  const refreshRuns = useEvalStore((s) => s.refreshRuns);
  useFetchRuns(benchmarkId);

  const sortedRuns = useMemo(
    () =>
      [...runList].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runList],
  );

  const filteredRuns = useMemo(() => {
    if (statusFilter === 'all') return sortedRuns;
    if (statusFilter === 'active') {
      return sortedRuns.filter((r) => r.status === 'running' || r.status === 'pending');
    }
    return sortedRuns.filter((r) => r.status === statusFilter);
  }, [sortedRuns, statusFilter]);

  const statusOptions = [
    { label: t('table.filter.all'), value: 'all' },
    { label: t('run.status.completed'), value: 'completed' },
    { label: t('run.filter.active'), value: 'active' },
    { label: t('run.status.idle'), value: 'idle' },
    { label: t('run.status.failed'), value: 'failed' },
    { label: t('run.status.aborted'), value: 'aborted' },
  ];

  return (
    <Flexbox gap={16}>
      {sortedRuns.length > 0 && (
        <Flexbox horizontal align="center" justify="space-between">
          <Flexbox horizontal align="center" gap={8}>
            <Text color={cssVar.colorTextTertiary}>
              {t('benchmark.detail.runCount', { count: filteredRuns.length })}
            </Text>
            <Select
              options={statusOptions}
              size="small"
              style={{ width: 128 }}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          </Flexbox>
          <Button
            icon={Plus}
            size="small"
            type="primary"
            onClick={() => createRunCreateModal({ benchmarkId })}
          >
            {t('run.actions.create')}
          </Button>
        </Flexbox>
      )}

      {sortedRuns.length === 0 ? (
        <EmptyState onCreate={() => createRunCreateModal({ benchmarkId })} />
      ) : filteredRuns.length === 0 ? (
        <Flexbox className={styles.filterEmpty}>
          <Text color={cssVar.colorTextTertiary}>{t('run.filter.empty')}</Text>
        </Flexbox>
      ) : (
        <div className={styles.grid}>
          {filteredRuns.map((run) => (
            <RunCard
              benchmarkId={benchmarkId}
              key={run.id}
              run={run}
              onEdit={(editingRun) => createRunEditModal({ run: editingRun })}
              onRefresh={refreshRuns}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

export default RunsTab;
