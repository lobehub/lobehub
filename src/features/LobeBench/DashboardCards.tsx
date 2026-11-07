'use client';

import type { AgentEvalExperimentListItem, AgentEvalRunListItem } from '@lobechat/types';
import { Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, Beaker, Database, Play, User } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { getBenchmarkIcon } from '@/features/LobeBench/benchmarkIcon';
import type { RankedContender } from '@/features/LobeBench/benchmarkRanking';
import {
  formatCost,
  isCustomBenchmark,
  isRunActive,
  LOBE_BENCH_PATH,
  runStats,
} from '@/features/LobeBench/lobeBench';
import { experimentCaseProgress, overviewAttention } from '@/features/LobeBench/overviewResults';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import RunRow from '@/routes/(main)/eval/features/Experiments/RunRow';

// The Evaluation Lab's dashboard cards (features/BenchmarkCard, Experiments/SummaryCard),
// drawn for Lobe Bench: its pages, its leaderboard rule.
const styles = stylex.create({
  card: {
    height: '100%',
    padding: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    transition: 'border-color 0.15s ease',
  },
  iconBox: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: cssVar.borderRadius,
  },
  name: {
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorPrimary },
    textDecoration: 'none',
  },
  detailLink: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  // The headline band: the leader's pass rate, as the Evaluation Lab shows a best pass rate.
  metricBand: {
    padding: 16,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  metricValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeHeading2,
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorText,
  },
  ctaBand: {
    paddingBlock: 24,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
  fixed: { flex: 'none', whiteSpace: 'nowrap' },
  statValue: { fontFamily: cssVar.fontFamilyCode, fontWeight: 600, color: cssVar.colorText },
  statDivider: { width: 1, height: 24, backgroundColor: cssVar.colorBorderSecondary },
  dot: { flexShrink: 0, width: 8, height: 8, borderRadius: '50%' },
});

const percent = (entry: RankedContender) =>
  entry.total > 0 ? Math.round((entry.passed / entry.total) * 100) : 0;

/** One labeled figure in the stat strip (big mono number over a quiet label). */
const Stat = memo<{ label: string; value: number | string }>(({ label, value }) => (
  <Flexbox gap={2}>
    <Text className={stylex.props(styles.statValue).className} fontSize={16}>
      {value}
    </Text>
    <Text color={cssVar.colorTextTertiary} fontSize={12}>
      {label}
    </Text>
  </Flexbox>
));

const CardHead = memo<{
  icon: ReactNode;
  subtitle?: ReactNode;
  title: string;
  to: string;
}>(({ icon, subtitle, title, to }) => (
  <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
    <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
      {icon}
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        <WorkspaceLink className={stylex.props(styles.name).className} to={to}>
          {title}
        </WorkspaceLink>
        {subtitle && (
          <Text color={cssVar.colorTextTertiary} fontSize={12} lineClamp={1}>
            {subtitle}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
    <WorkspaceLink className={stylex.props(styles.detailLink).className} to={to}>
      <Icon icon={ArrowRight} size={16} />
    </WorkspaceLink>
  </Flexbox>
));

const CtaBand = memo<{
  action: ReactNode;
  hint: string;
  icon: typeof Database;
  title: string;
}>(({ action, hint, icon, title }) => (
  <Flexbox align={'center'} className={stylex.props(styles.ctaBand).className} gap={8}>
    <Icon icon={icon} size={24} style={{ color: cssVar.colorTextQuaternary }} />
    <Flexbox align={'center'} gap={2}>
      <Text color={cssVar.colorTextTertiary}>{title}</Text>
      <Text color={cssVar.colorTextQuaternary} fontSize={12}>
        {hint}
      </Text>
    </Flexbox>
    {action}
  </Flexbox>
));

interface BenchmarkCardProps {
  benchmark: { description?: string | null; id: string; isSystem?: boolean; name: string };
  caseCount: number;
  datasetCount: number;
  /** The dataset a first experiment starts on. */
  firstDatasetId?: string;
  /** Set when the benchmark has several datasets: the one ranked. */
  rankedOn?: string;
  /** The leaderboard shown: the benchmark's dataset with the most ranked contenders. */
  ranking: RankedContender[];
  runCount: number;
}

/**
 * A benchmark on the dashboard: who leads its leaderboard (best full run on the
 * current cases), the runner-ups, and what it is made of.
 */
export const BenchmarkCard = memo<BenchmarkCardProps>(
  ({ benchmark, caseCount, datasetCount, firstDatasetId, ranking, rankedOn, runCount }) => {
    const { t } = useTranslation('eval');
    const to = `${LOBE_BENCH_PATH}/benchmarks/${benchmark.id}`;
    const own = isCustomBenchmark(benchmark);
    const [leader, ...rest] = ranking;

    return (
      <Flexbox className={stylex.props(styles.card).className} gap={16} justify={'space-between'}>
        <Flexbox gap={16}>
          <CardHead
            subtitle={benchmark.description}
            title={benchmark.name}
            to={to}
            icon={
              <div
                className={stylex.props(styles.iconBox).className}
                style={{ background: own ? cssVar.colorSuccessBg : cssVar.colorPrimaryBg }}
              >
                <Icon
                  icon={own ? User : getBenchmarkIcon(benchmark.id)}
                  size={22}
                  style={{ color: own ? cssVar.colorSuccess : cssVar.colorPrimary }}
                />
              </div>
            }
          />

          {datasetCount === 0 ? (
            <CtaBand
              hint={t('lobeBench.overview.card.noDatasetHint')}
              icon={Database}
              title={t('lobeBench.overview.card.noDataset')}
              action={
                <WorkspaceLink style={{ textDecoration: 'none' }} to={to}>
                  <Button size={'small'} type={'fill'}>
                    {t('lobeBench.overview.card.openBenchmark')}
                  </Button>
                </WorkspaceLink>
              }
            />
          ) : leader ? (
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.metricBand).className}
              gap={16}
              justify={'space-between'}
            >
              <Flexbox gap={6} style={{ minWidth: 0 }}>
                <span className={stylex.props(styles.metricValue).className}>
                  {percent(leader)}%
                </span>
                <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
                  {t('lobeBench.overview.card.top', { name: leader.name })}
                  {rankedOn && ` · ${t('lobeBench.overview.card.on', { dataset: rankedOn })}`}
                </Text>
              </Flexbox>
              {rest.length > 0 && (
                <Flexbox gap={4} style={{ flex: '0 1 50%', minWidth: 0 }}>
                  {rest.slice(0, 2).map((entry, index) => (
                    <Flexbox horizontal align={'center'} gap={8} key={entry.run.id}>
                      <Text
                        className={stylex.props(styles.mono, styles.fixed).className}
                        color={cssVar.colorTextQuaternary}
                        fontSize={12}
                      >
                        #{index + 2}
                      </Text>
                      <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }}>
                        {entry.name}
                      </Text>
                      <Text
                        className={stylex.props(styles.mono, styles.fixed).className}
                        fontSize={12}
                      >
                        {percent(entry)}%
                      </Text>
                    </Flexbox>
                  ))}
                </Flexbox>
              )}
            </Flexbox>
          ) : (
            <CtaBand
              hint={t('lobeBench.overview.card.noRunHint')}
              icon={Beaker}
              title={t('lobeBench.overview.card.noRun')}
              action={
                <WorkspaceLink
                  style={{ textDecoration: 'none' }}
                  to={
                    firstDatasetId
                      ? `${LOBE_BENCH_PATH}/experiments/new?dataset=${firstDatasetId}`
                      : `${LOBE_BENCH_PATH}/experiments/new`
                  }
                >
                  <Button icon={Play} size={'small'} type={'fill'}>
                    {t('lobeBench.overview.newExperiment')}
                  </Button>
                </WorkspaceLink>
              }
            />
          )}
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={20}>
          <Stat label={t('sidebar.datasets')} value={datasetCount} />
          <span className={stylex.props(styles.statDivider).className} />
          <Stat label={t('benchmark.card.casesLabel')} value={caseCount} />
          <span className={stylex.props(styles.statDivider).className} />
          <Stat label={t('lobeBench.overview.card.runs')} value={runCount} />
          <span className={stylex.props(styles.statDivider).className} />
          <Stat label={t('lobeBench.overview.card.contenders')} value={ranking.length} />
        </Flexbox>
      </Flexbox>
    );
  },
);

BenchmarkCard.displayName = 'LobeBenchDashboardBenchmarkCard';

interface ExperimentCardProps {
  /** The benchmark each run's page lives under, by run id. */
  benchmarkIdOf: (run: AgentEvalRunListItem) => string;
  description: string;
  experiment: AgentEvalExperimentListItem;
  runs: AgentEvalRunListItem[];
}

const ATTENTION = [
  ['errors', 'lobeBench.overview.attention.errors'],
  ['judgeErrors', 'lobeBench.overview.attention.judgeErrors'],
  ['unaccounted', 'lobeBench.overview.attention.ungraded'],
  ['external', 'lobeBench.overview.attention.external'],
] as const;

/**
 * An experiment on the dashboard, as the Evaluation Lab shows one: what it ran,
 * its progress while running, what needs a look, and its latest runs.
 */
export const ExperimentCard = memo<ExperimentCardProps>(
  ({ benchmarkIdOf, description, experiment, runs }) => {
    const { t } = useTranslation('eval');
    const to = `${LOBE_BENCH_PATH}/experiments/${experiment.id}`;
    const active = runs.some((run) => isRunActive(run.status));
    const progress = experimentCaseProgress(runs);
    const cost = runs.reduce((sum, run) => sum + (runStats(run).totalCost ?? 0), 0);
    const attention = overviewAttention(runs);
    const flags = ATTENTION.filter(([key]) => attention[key] > 0);

    return (
      <Flexbox className={stylex.props(styles.card).className} gap={16}>
        <CardHead
          subtitle={`${description}${!active && cost > 0 ? ` · ${formatCost(cost, 2)}` : ''}`}
          title={experiment.name || t('lobeBench.experiment.unnamed')}
          to={to}
          icon={
            <div
              className={stylex.props(styles.iconBox).className}
              style={{ background: cssVar.colorInfoBg }}
            >
              <Icon icon={Beaker} size={22} style={{ color: cssVar.colorInfo }} />
            </div>
          }
        />

        {(active || flags.length > 0) && (
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            {active && (
              <Flexbox horizontal align={'center'} gap={8}>
                <span
                  className={stylex.props(styles.dot).className}
                  style={{ background: cssVar.colorPrimary }}
                />
                <Text fontSize={12} type={'secondary'}>
                  {t('lobeBench.overview.running')} ·{' '}
                  {t('lobeBench.overview.runningLine', {
                    cost: formatCost(cost, 2),
                    done: progress.done,
                    total: progress.total,
                  })}
                </Text>
              </Flexbox>
            )}
            {flags.map(([key, label]) => (
              <Tag color={'warning'} key={key}>
                {t(label, { count: attention[key] })}
              </Tag>
            ))}
          </Flexbox>
        )}

        {runs.length > 0 && (
          <Flexbox gap={0}>
            {runs.slice(0, 3).map((run) => (
              <RunRow benchmarkId={benchmarkIdOf(run)} key={run.id} run={run} />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ExperimentCard.displayName = 'LobeBenchDashboardExperimentCard';
