'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { Flexbox, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isFullRun,
  isRunOnCaseVersion,
  type RankableSet,
  runCaseCount,
  runCoversSet,
} from '@/features/LobeBench/lobeBench';
import { createRunEditModal } from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunEditModal';
import RunCard from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunsTab/RunCard';

const styles = stylex.create({
  sectionTitle: {
    margin: 0,
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
    gap: 12,
  },
  filterEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 48,
    paddingInline: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

interface RunsSectionProps {
  /** Beside the title, e.g. the benchmark's "New experiment". */
  action?: ReactNode;
  /** The benchmark a run card links into (its run page lives under it). */
  benchmarkId?: string;
  /** How many runs the filter leaves, worded for the page. */
  countLabel: (count: number) => string;
  /** Read for each run's case count, to say when it ran only some of the cases. */
  datasets?: Array<{ id: string; testCaseCount?: number | null }>;
  emptyLabel: string;
  onRefresh: () => Promise<unknown>;
  /** The ranked case sets: a run on an earlier version of their cases says it does not rank. */
  rankedSets?: RankableSet[];
  runs: AgentEvalRunListItem[];
}

/**
 * The run cards of a Lobe Bench page, newest first, with a status filter: the
 * benchmark lists every run on its datasets, an experiment one run per contender.
 */
const RunsSection = memo<RunsSectionProps>(
  ({ action, benchmarkId, countLabel, datasets, emptyLabel, onRefresh, rankedSets, runs }) => {
    const { t } = useTranslation('eval');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const sortedRuns = useMemo(
      () =>
        [...runs].sort(
          (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
        ),
      [runs],
    );
    const filteredRuns = useMemo(() => {
      if (statusFilter === 'all') return sortedRuns;
      if (statusFilter === 'active') {
        return sortedRuns.filter((r) => r.status === 'running' || r.status === 'pending');
      }
      return sortedRuns.filter((r) => r.status === statusFilter);
    }, [sortedRuns, statusFilter]);

    const handleRefresh = useCallback(async () => {
      await onRefresh();
    }, [onRefresh]);

    const statusOptions = [
      { label: t('table.filter.all'), value: 'all' },
      { label: t('run.status.completed'), value: 'completed' },
      { label: t('run.filter.active'), value: 'active' },
      { label: t('run.status.idle'), value: 'idle' },
      { label: t('run.status.failed'), value: 'failed' },
      { label: t('run.status.aborted'), value: 'aborted' },
    ];

    const noteOf = (run: AgentEvalRunListItem) => {
      // A run on an earlier version of the cases stays listed, but does not rank.
      if (rankedSets?.some((set) => runCoversSet(run, set) && !isRunOnCaseVersion(run, set)))
        return t('lobeBench.benchmark.outdatedRun');
      const setSize = datasets?.find((dataset) => dataset.id === run.datasetId)?.testCaseCount ?? 0;
      return isFullRun(run) || !setSize
        ? undefined
        : t('lobeBench.benchmark.runCases', {
            selected: runCaseCount(run, setSize),
            total: setSize,
          });
    };

    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <h3 className={stylex.props(styles.sectionTitle).className}>
              {t('lobeBench.benchmark.runs')}
            </h3>
            {sortedRuns.length > 0 && (
              <>
                <Text type={'secondary'}>{countLabel(filteredRuns.length)}</Text>
                <Select
                  options={statusOptions}
                  size={'small'}
                  style={{ width: 128 }}
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as string)}
                />
              </>
            )}
          </Flexbox>
          {action}
        </Flexbox>
        {sortedRuns.length === 0 ? (
          <Flexbox className={stylex.props(styles.filterEmpty).className}>
            <Text type={'secondary'}>{emptyLabel}</Text>
          </Flexbox>
        ) : filteredRuns.length === 0 ? (
          <Flexbox className={stylex.props(styles.filterEmpty).className}>
            <Text type={'secondary'}>{t('run.filter.empty')}</Text>
          </Flexbox>
        ) : (
          <div className={stylex.props(styles.grid).className}>
            {filteredRuns.map((run) => (
              <RunCard
                benchmarkId={benchmarkId ?? ''}
                key={run.id}
                note={noteOf(run)}
                run={run}
                onEdit={(editingRun) => createRunEditModal({ run: editingRun })}
                onRefresh={handleRefresh}
              />
            ))}
          </div>
        )}
      </Flexbox>
    );
  },
);

RunsSection.displayName = 'RunsSection';

export default RunsSection;
