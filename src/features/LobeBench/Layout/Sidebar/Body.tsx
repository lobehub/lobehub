'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  cx,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Text,
} from '@lobehub/ui';
import {
  Beaker,
  Database,
  LayoutDashboardIcon,
  LibraryBig,
  MoreHorizontalIcon,
  PlusIcon,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getBenchmarkIcon } from '@/features/LobeBench/benchmarkIcon';
import { openCreateBenchmarkModal } from '@/features/LobeBench/BenchmarkModal';
import {
  benchmarkDatasetsOf,
  customDatasetsOf,
  isCustomBenchmark,
  isRunActive,
  LOBE_BENCH_PATH,
  looseDatasetsOf,
  sortBenchmarks,
} from '@/features/LobeBench/lobeBench';
import { useDeleteExperiment } from '@/features/LobeBench/useDeleteExperiment';
import {
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchExperiments,
} from '@/features/LobeBench/useLobeBench';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { isModifierClick } from '@/utils/navigation';

const useActiveKey = () => {
  const { pathname } = useActiveLocation();
  if (pathname.endsWith('/experiments/new')) return 'new';
  if (pathname.endsWith('/library')) return 'library';
  if (pathname.endsWith('/settings')) return 'settings';
  if (pathname.endsWith('/contenders')) return 'contenders';
  const match = pathname.match(/\/lobe-bench\/(experiments|benchmarks|datasets)\/([^/]+)/);
  if (match) return `${match[1].slice(0, -1)}-${match[2]}`;
  return 'overview';
};

const Body = memo(() => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const activeKey = useActiveKey();
  const { experiments, isInit } = useLobeBenchExperiments();
  const deleteExperiment = useDeleteExperiment();
  const { benchmarks: benchmarkList } = useLobeBenchBenchmarks();
  const benchmarks = useMemo(() => sortBenchmarks(benchmarkList), [benchmarkList]);
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  // Every benchmark is made of a built-in dataset: those come
  // first, in benchmark order, then the account's own datasets.
  const sidebarDatasets = useMemo(
    () => [
      ...benchmarks
        .filter((b) => !isCustomBenchmark(b))
        .flatMap((b) => benchmarkDatasetsOf(datasets, b)),
      ...customDatasetsOf(datasets),
    ],
    [benchmarks, datasets],
  );
  const createBenchmark = () =>
    openCreateBenchmarkModal({
      datasets: looseDatasetsOf(datasets, benchmarks),
      onCreated: (id) => navigate(`${LOBE_BENCH_PATH}/benchmarks/${id}`),
    });

  const link = (to: string, node: React.ReactNode) => (
    <WorkspaceLink
      to={to}
      onClick={(e) => {
        if (isModifierClick(e)) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {node}
    </WorkspaceLink>
  );

  return (
    // Fills the scroll area so the utility links can sit at the bottom.
    <Flexbox gap={8} paddingInline={4} style={{ minHeight: '100%', paddingBlockEnd: 8 }}>
      <Flexbox gap={1}>
        {link(
          LOBE_BENCH_PATH,
          <NavItem
            active={activeKey === 'overview'}
            icon={LayoutDashboardIcon}
            title={t('lobeBench.sidebar.overview')}
          />,
        )}
      </Flexbox>
      <AccordionRoot
        defaultValue={['experiments', 'benchmarks', 'datasets']}
        indicatorPlacement="inline"
        style={{ gap: 8 }}
      >
        <AccordionItem value={'experiments'}>
          <AccordionHeader style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
            <AccordionTrigger>
              <Flexbox horizontal align="center" gap={4}>
                <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                  {t('lobeBench.sidebar.experiments')}
                </Text>
                {experiments.length > 0 && (
                  <Text fontSize={12} type="secondary">
                    {experiments.length}
                  </Text>
                )}
              </Flexbox>
            </AccordionTrigger>
            <div
              className={cx(
                'accordion-action',
                accordionStyles.action,
                accordionStyles.actionBorderless,
              )}
            >
              <ActionIcon
                icon={PlusIcon}
                size={'small'}
                title={t('lobeBench.sidebar.newExperiment')}
                onClick={() => navigate(`${LOBE_BENCH_PATH}/experiments/new`)}
              />
            </div>
          </AccordionHeader>
          <AccordionPanel>
            <Flexbox gap={1} paddingBlock={1}>
              {activeKey === 'new' && (
                <NavItem active icon={Beaker} iconSize={16} title={t('lobeBench.sidebar.draft')} />
              )}
              {!isInit && experiments.length === 0 ? (
                <SkeletonList rows={2} />
              ) : experiments.length === 0 ? (
                <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
                  {t('lobeBench.sidebar.empty')}
                </Text>
              ) : (
                experiments.map((experiment) => {
                  const running = !!experiment.recentRuns?.some((run) => isRunActive(run.status));
                  const current = activeKey === `experiment-${experiment.id}`;
                  // Same row menu as the Lab's lists: delete sits behind "more" and the right click.
                  const menu = (): DropdownItem[] => [
                    {
                      danger: true,
                      disabled: running,
                      icon: <Trash2 size={16} />,
                      key: 'delete',
                      label: running ? t('lobeBench.experiment.delete.active') : t('common.delete'),
                      onClick: () =>
                        deleteExperiment(experiment, { active: running, leave: current }),
                    },
                  ];
                  return (
                    <div key={experiment.id}>
                      {link(
                        `${LOBE_BENCH_PATH}/experiments/${experiment.id}`,
                        <NavItem
                          active={current}
                          contextMenuItems={menu}
                          icon={Beaker}
                          iconSize={16}
                          loading={running}
                          title={experiment.name}
                          actions={
                            // Keep the row's link from firing when the menu is used.
                            <span
                              role={'presentation'}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <DropdownMenu
                                items={menu()}
                                placement={'bottomRight'}
                                trigger={['click']}
                              >
                                <ActionIcon
                                  icon={MoreHorizontalIcon}
                                  size={'small'}
                                  style={{ flex: 'none' }}
                                  title={t('lobeBench.experiment.more')}
                                />
                              </DropdownMenu>
                            </span>
                          }
                        />,
                      )}
                    </div>
                  );
                })
              )}
            </Flexbox>
          </AccordionPanel>
        </AccordionItem>
        {/* Same three groups as the Evaluation Lab: experiments, benchmarks, datasets. */}
        <AccordionItem value={'benchmarks'}>
          <AccordionHeader style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
            <AccordionTrigger>
              <Flexbox horizontal align="center" gap={4}>
                <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                  {t('lobeBench.sidebar.benchmarks')}
                </Text>
                {benchmarks.length > 0 && (
                  <Text fontSize={12} type="secondary">
                    {benchmarks.length}
                  </Text>
                )}
              </Flexbox>
            </AccordionTrigger>
            <div
              className={cx(
                'accordion-action',
                accordionStyles.action,
                accordionStyles.actionBorderless,
              )}
            >
              <ActionIcon
                icon={PlusIcon}
                size={'small'}
                title={t('lobeBench.sidebar.newBenchmark')}
                onClick={createBenchmark}
              />
            </div>
          </AccordionHeader>
          <AccordionPanel>
            <Flexbox gap={1} paddingBlock={1}>
              {benchmarks.length === 0 ? (
                <SkeletonList rows={2} />
              ) : (
                benchmarks.map((benchmark) => (
                  <div key={benchmark.id}>
                    {link(
                      `${LOBE_BENCH_PATH}/benchmarks/${benchmark.id}`,
                      <NavItem
                        active={activeKey === `benchmark-${benchmark.id}`}
                        icon={getBenchmarkIcon(benchmark.id)}
                        iconSize={16}
                        title={benchmark.name}
                      />,
                    )}
                  </div>
                ))
              )}
            </Flexbox>
          </AccordionPanel>
        </AccordionItem>
        {/* The datasets the benchmarks are made of, then the account's own (cases
            picked from the library, or its own), flat like the Evaluation Lab's list. */}
        <AccordionItem value={'datasets'}>
          <AccordionHeader style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
            <AccordionTrigger>
              <Flexbox horizontal align="center" gap={4}>
                <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                  {t('lobeBench.sidebar.datasets')}
                </Text>
                {sidebarDatasets.length > 0 && (
                  <Text fontSize={12} type="secondary">
                    {sidebarDatasets.length}
                  </Text>
                )}
              </Flexbox>
            </AccordionTrigger>
          </AccordionHeader>
          <AccordionPanel>
            <Flexbox gap={1} paddingBlock={1}>
              {!datasets ? (
                <SkeletonList rows={2} />
              ) : sidebarDatasets.length === 0 ? (
                <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
                  {t('lobeBench.sidebar.datasets.empty')}
                </Text>
              ) : (
                sidebarDatasets.map((dataset) => (
                  <div key={dataset.id}>
                    {link(
                      `${LOBE_BENCH_PATH}/datasets/${dataset.id}`,
                      <NavItem
                        active={activeKey === `dataset-${dataset.id}`}
                        icon={Database}
                        iconSize={16}
                        title={dataset.name}
                      />,
                    )}
                  </div>
                ))
              )}
            </Flexbox>
          </AccordionPanel>
        </AccordionItem>
      </AccordionRoot>
      {/* Reference and account pages: pinned to the bottom, apart from the working lists above. */}
      <Flexbox gap={1} style={{ marginBlockStart: 'auto' }}>
        {link(
          `${LOBE_BENCH_PATH}/library`,
          <NavItem
            active={activeKey === 'library'}
            icon={LibraryBig}
            title={t('lobeBench.sidebar.library')}
          />,
        )}
        {link(
          `${LOBE_BENCH_PATH}/contenders`,
          <NavItem
            active={activeKey === 'contenders'}
            icon={Users}
            title={t('lobeBench.sidebar.contenders')}
          />,
        )}
        {link(
          `${LOBE_BENCH_PATH}/settings`,
          <NavItem
            active={activeKey === 'settings'}
            icon={Settings2}
            title={t('lobeBench.sidebar.settings')}
          />,
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default Body;
