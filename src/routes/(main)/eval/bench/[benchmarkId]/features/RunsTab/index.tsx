'use client';

import { Button, Flexbox, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { runSelectors, useEvalStore } from '@/store/eval';

import { createRunCreateModal } from '../RunCreateModal';
import { createRunEditModal } from '../RunEditModal';
import EmptyState from './EmptyState';
import RunCard from './RunCard';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(auto-fill, minmax(420px, 1fr))',
      '@media (width <= 640px)': '1fr',
    },
    gap: '12px',
  },
  filterEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '48px',
    paddingInline: '24px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

interface RunsTabProps {
  benchmarkId: string;
}

const RunsTab = memo<RunsTabProps>(({ benchmarkId }) => {
  const { t } = useTranslation('eval');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const useFetchRuns = useEvalStore((s) => s.useFetchRuns);
  const runList = useEvalStore(runSelectors.runList(benchmarkId));
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
        <Flexbox className={stylex.props(styles.filterEmpty).className}>
          <Text color={cssVar.colorTextTertiary}>{t('run.filter.empty')}</Text>
        </Flexbox>
      ) : (
        <div {...stylex.props(styles.grid)}>
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
