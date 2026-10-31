'use client';

import { Button, confirmModal, Empty, Flexbox, Tag, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Pencil, Play, Trash2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import CaseTable from '@/features/LobeBench/CaseTable';
import { refreshLobeBenchDatasets } from '@/features/LobeBench/datasetCases';
import {
  caseCountOf,
  getDatasetMeta,
  isBuiltInRow,
  isCustomBenchmark,
  isCustomDataset,
  isFullRun,
  LOBE_BENCH_PATH,
  runCaseCount,
} from '@/features/LobeBench/lobeBench';
import { openRenameDatasetModal } from '@/features/LobeBench/PicksDatasetModal';
import {
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchRuns,
} from '@/features/LobeBench/useLobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { createRunEditModal } from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunEditModal';
import RunCard from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunsTab/RunCard';
import { agentEvalService } from '@/services/agentEval';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
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
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 32,
    paddingInline: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

/**
 * One dataset: the cases it holds and the runs on it, as the Evaluation Lab
 * shows a dataset. Its cases are fixed once it is made, so
 * its runs stay true to it: a built-in one (the library, Hard 50) is read-only,
 * and the account's own can only be renamed or deleted.
 */
const LobeBenchDataset = memo(() => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const { datasetId } = useParams<{ datasetId: string }>();
  const { benchmarks, isLoading } = useLobeBenchBenchmarks();
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  const dataset = datasets?.find((d) => d.id === datasetId);
  const benchmark = benchmarks.find((b) => b.id === dataset?.benchmarkId);
  const meta = dataset ? getDatasetMeta(dataset) : {};
  const own = !!dataset && isCustomDataset(dataset);
  const { data: allRuns, mutate: refreshRuns } = useLobeBenchRuns(benchmarkIds);
  const runs = useMemo(
    () =>
      (allRuns ?? [])
        .filter((run) => run.datasetId === datasetId)
        .sort(
          (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
        ),
    [allRuns, datasetId],
  );

  if (!dataset) {
    return (
      <Flexbox className={stylex.props(styles.container).className} flex={1}>
        {!isLoading && datasets && <Empty description={t('lobeBench.dataset.notFound')} />}
      </Flexbox>
    );
  }

  const count = caseCountOf(dataset);
  const remove = () =>
    confirmModal({
      content: t('lobeBench.picks.delete.confirm', { name: dataset.name }),
      okButtonProps: { danger: true },
      okText: t('lobeBench.picks.delete'),
      onOk: async () => {
        const result = (await agentEvalService.deleteDataset(dataset.id)) as {
          error?: string;
          success?: boolean;
        };
        if (result?.success === false) {
          toast.error(result.error ?? t('lobeBench.picks.failed'));
          return;
        }
        await refreshLobeBenchDatasets();
        navigate(`${LOBE_BENCH_PATH}/library`);
      },
      title: t('lobeBench.picks.delete'),
    });

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={20}>
      <Flexbox horizontal align={'flex-end'} gap={16} justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={6} style={{ minWidth: 0 }}>
          {/* The benchmark the dataset makes up: a built-in one's, or one the account
              made; the account's other datasets are in none. */}
          {benchmark && (!own || isCustomBenchmark(benchmark)) && (
            <WorkspaceLink to={`${LOBE_BENCH_PATH}/benchmarks/${benchmark.id}`}>
              <Text fontSize={12} type={'secondary'}>
                {benchmark.name}
              </Text>
            </WorkspaceLink>
          )}
          <Text as={'h1'} fontSize={24} weight={600}>
            {dataset.name}
          </Text>
          {own ? (
            <Text type={'secondary'}>{t('lobeBench.dataset.own.subtitle', { count })}</Text>
          ) : (
            dataset.description && <Text type={'secondary'}>{dataset.description}</Text>
          )}
          <Flexbox horizontal gap={6} wrap={'wrap'}>
            {own && <Tag>{t('lobeBench.dataset.custom')}</Tag>}
            {meta.release && <Tag>{t('lobeBench.dataset.release', { release: meta.release })}</Tag>}
            {!own && (
              <Tag>
                {isBuiltInRow(dataset as { userId?: string | null })
                  ? t('lobeBench.builtIn')
                  : t('lobeBench.case.readOnly')}
              </Tag>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Button
            disabled={count === 0}
            icon={Play}
            type={'primary'}
            onClick={() => navigate(`${LOBE_BENCH_PATH}/experiments/new?dataset=${dataset.id}`)}
          >
            {t('lobeBench.picks.run')}
          </Button>
          {own && (
            <>
              <Button icon={Pencil} onClick={() => openRenameDatasetModal(dataset)}>
                {t('lobeBench.picks.rename')}
              </Button>
              <Button danger icon={Trash2} onClick={remove}>
                {t('lobeBench.picks.delete')}
              </Button>
            </>
          )}
        </Flexbox>
      </Flexbox>

      <CaseTable benchmarkIds={benchmarkIds} dataset={dataset} />

      {/* The runs on this dataset, as the Evaluation Lab lists a dataset's runs. */}
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <h3 className={stylex.props(styles.sectionTitle).className}>
            {t('lobeBench.benchmark.runs')}
          </h3>
          {runs.length > 0 && (
            <Text type={'secondary'}>
              {t('lobeBench.dataset.runCount', { count: runs.length })}
            </Text>
          )}
        </Flexbox>
        {runs.length === 0 ? (
          <Flexbox className={stylex.props(styles.empty).className}>
            <Text type={'secondary'}>{t('lobeBench.dataset.noRuns')}</Text>
          </Flexbox>
        ) : (
          <div className={stylex.props(styles.grid).className}>
            {runs.map((run) => (
              <RunCard
                benchmarkId={dataset.benchmarkId ?? benchmarkIds[0]}
                key={run.id}
                run={run}
                note={
                  isFullRun(run) || !count
                    ? undefined
                    : t('lobeBench.benchmark.runCases', {
                        selected: runCaseCount(run, count),
                        total: count,
                      })
                }
                onEdit={(editingRun) => createRunEditModal({ run: editingRun })}
                onRefresh={async () => {
                  await refreshRuns();
                }}
              />
            ))}
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

LobeBenchDataset.displayName = 'LobeBenchDataset';

export default LobeBenchDataset;
