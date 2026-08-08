'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { formatCost } from '@lobechat/utils';
import { type DropdownItem, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CircleDollarSign,
  Clock,
  Edit,
  EllipsisVertical,
  Layers,
  Server,
  Trash2,
  Trophy,
  User,
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useEvalStore } from '@/store/eval';

import { createBenchmarkEditModal } from '../../../../features/BenchmarkEditModal';
import Sparkline from '../../../../features/Sparkline';
import { formatDuration, formatDurationMinutes } from '../../../../utils';

const RANK_COLORS = [cssVar.colorPrimary, cssVar.colorSuccess, cssVar.colorTextQuaternary];

const styles = createStaticStyles(({ css, cssVar }) => ({
  heroBand: css`
    padding: 20px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  heroValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading1};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  description: css`
    margin: 0;
    margin-block-start: 2px;
    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextTertiary};
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  statCard: css`
    flex: 1;

    min-width: 0;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  statIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};
  `,
  statLabel: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    margin: 0;
    font-size: ${cssVar.fontSizeHeading3};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface BenchmarkHeaderProps {
  benchmark: any;
  completedRuns: AgentEvalRunListItem[];
  datasets: any[];
  onBenchmarkUpdate?: (benchmark: any) => void;
  runCount: number;
  systemIcon?: LucideIcon;
  totalCases: number;
}

const BenchmarkHeader = memo<BenchmarkHeaderProps>(
  ({
    benchmark,
    completedRuns,
    datasets,
    onBenchmarkUpdate,
    runCount,
    systemIcon = Server,
    totalCases,
  }) => {
    const { t } = useTranslation('eval');
    const navigate = useWorkspaceAwareNavigate();
    const deleteBenchmark = useEvalStore((s) => s.deleteBenchmark);
    const refreshBenchmarkDetail = useEvalStore((s) => s.refreshBenchmarkDetail);

    const handleEditSuccess = async () => {
      await refreshBenchmarkDetail(benchmark.id);
      onBenchmarkUpdate?.(benchmark);
    };

    const handleEdit = () => createBenchmarkEditModal({ benchmark, onSuccess: handleEditSuccess });

    const handleDelete = () => {
      confirmModal({
        content: t('benchmark.actions.delete.confirm'),
        okButtonProps: { danger: true },
        okText: t('benchmark.actions.delete'),
        onOk: async () => {
          await deleteBenchmark(benchmark.id);
          navigate('/eval');
        },
        title: t('benchmark.actions.delete'),
      });
    };

    const menuItems: DropdownItem[] = [
      {
        danger: true,
        icon: <Trash2 size={16} />,
        key: 'delete',
        label: t('common.delete'),
        onClick: handleDelete,
      },
    ];

    // === Stats Computations ===

    const hasDatasets = datasets.length > 0;
    const hasCompletedRuns = completedRuns.length > 0;

    // Top Agents: group by targetAgent, compute avg passRate, sort desc, take top 3
    const topAgents = useMemo(() => {
      if (!hasCompletedRuns) return [];
      const agentMap = new Map<string, { name: string; passRates: number[] }>();
      for (const run of completedRuns) {
        const agentName = run.targetAgent?.title || run.targetAgent?.id || 'Unknown';
        const agentId = run.targetAgentId || run.targetAgent?.id || agentName;
        if (!agentMap.has(agentId)) {
          agentMap.set(agentId, { name: agentName, passRates: [] });
        }
        agentMap.get(agentId)!.passRates.push(run.passRate ?? run.metrics?.passRate ?? 0);
      }
      return [...agentMap.entries()]
        .map(([, v]) => ({
          avgPassRate: v.passRates.reduce((a, b) => a + b, 0) / v.passRates.length,
          name: v.name,
        }))
        .sort((a, b) => b.avgPassRate - a.avgPassRate)
        .slice(0, 3);
    }, [completedRuns, hasCompletedRuns]);

    // Best agent for the summary line
    const bestAgent = topAgents.length > 0 ? topAgents[0] : null;

    // Pass-rate trend across completed runs (reversed to read oldest→newest) for
    // the hero sparkline; the best rate anchors the headline number.
    const passRateTrend = useMemo(() => {
      const rates = completedRuns
        .map((r) => r.passRate ?? r.metrics?.passRate)
        .filter((v): v is number => typeof v === 'number');
      return rates.reverse();
    }, [completedRuns]);
    const bestPassRate = passRateTrend.length > 0 ? Math.max(...passRateTrend) : undefined;

    // Avg Duration
    const avgDuration = useMemo(() => {
      if (!hasCompletedRuns) return null;
      const durations = completedRuns
        .map((r) => r.metrics?.duration ?? r.totalDuration)
        .filter((d): d is number => d != null && d > 0);
      if (durations.length === 0) return null;
      return durations.reduce((a, b) => a + b, 0) / durations.length;
    }, [completedRuns, hasCompletedRuns]);

    // P99 Duration
    const p99Duration = useMemo(() => {
      if (!hasCompletedRuns) return null;
      const durations = completedRuns
        .map((r) => r.metrics?.duration ?? r.totalDuration)
        .filter((d): d is number => d != null && d > 0)
        .sort((a, b) => a - b);
      if (durations.length === 0) return null;
      const idx = Math.ceil(durations.length * 0.99) - 1;
      return durations[idx];
    }, [completedRuns, hasCompletedRuns]);

    // Avg Cost
    const avgCost = useMemo(() => {
      if (!hasCompletedRuns) return null;
      const costs = completedRuns
        .map((r) => r.metrics?.totalCost ?? r.totalCost)
        .filter((c): c is number => c != null && c > 0);
      if (costs.length === 0) return null;
      return costs.reduce((a, b) => a + b, 0) / costs.length;
    }, [completedRuns, hasCompletedRuns]);

    return (
      <>
        {/* Header */}
        <Flexbox gap={16}>
          <Flexbox horizontal align="start" justify="space-between">
            <Flexbox horizontal align="start" gap={12}>
              <div
                className={styles.iconBox}
                style={{
                  background:
                    benchmark.source === 'user' ? cssVar.colorSuccessBg : cssVar.colorPrimaryBg,
                }}
              >
                <Icon
                  icon={benchmark.source === 'user' ? User : systemIcon}
                  size={20}
                  style={{
                    color: benchmark.source === 'user' ? cssVar.colorSuccess : cssVar.colorPrimary,
                  }}
                />
              </div>
              <Flexbox gap={4}>
                <h1 className={styles.title}>{benchmark.name}</h1>
                {benchmark.description && (
                  <p className={styles.description}>{benchmark.description}</p>
                )}
              </Flexbox>
            </Flexbox>

            <Flexbox horizontal gap={8}>
              <Button icon={Edit} size="small" onClick={handleEdit}>
                {t('common.edit')}
              </Button>
              <DropdownMenu items={menuItems} placement="bottomRight">
                <Button icon={EllipsisVertical} size="small" />
              </DropdownMenu>
            </Flexbox>
          </Flexbox>
        </Flexbox>

        {/* Results hero — headline best pass rate + trend across completed runs.
            Always rendered (shows a muted dash before the first completed run) so
            the benchmark always leads with its outcome. */}
        <Flexbox
          horizontal
          align={'center'}
          className={styles.heroBand}
          gap={16}
          justify={'space-between'}
        >
          <Flexbox gap={6}>
            <span className={styles.heroValue}>
              {bestPassRate !== undefined ? `${(bestPassRate * 100).toFixed(0)}%` : '—'}
            </span>
            <Text color={cssVar.colorTextSecondary} fontSize={14}>
              {bestAgent
                ? t('benchmark.detail.stats.bestPerformance', {
                    agent: bestAgent.name,
                    passRate: (bestAgent.avgPassRate * 100).toFixed(1),
                  })
                : t('benchmark.card.bestPassRate')}
            </Text>
          </Flexbox>
          {passRateTrend.length > 1 && <Sparkline values={passRateTrend} width={220} />}
        </Flexbox>

        {/* Stats Cards */}
        <Flexbox horizontal gap={12}>
          {/* Card 1: Top Agents */}
          <div className={styles.statCard}>
            <Flexbox gap={12}>
              <Flexbox horizontal align="center" gap={8}>
                <div className={styles.statIcon} style={{ background: cssVar.colorWarningBg }}>
                  <Trophy size={16} style={{ color: cssVar.colorWarning }} />
                </div>
                <span className={styles.statLabel} style={{ textTransform: 'uppercase' }}>
                  {t('benchmark.detail.stats.topAgents')}
                </span>
              </Flexbox>

              {!hasDatasets && !hasCompletedRuns && (
                <span
                  style={{
                    color: cssVar.colorTextQuaternary,
                    fontSize: cssVar.fontSizeXL,
                    fontWeight: 600,
                  }}
                >
                  --
                </span>
              )}

              {hasDatasets && !hasCompletedRuns && (
                <Flexbox gap={2}>
                  <span
                    style={{
                      color: cssVar.colorTextQuaternary,
                      fontSize: cssVar.fontSizeXL,
                      fontWeight: 600,
                    }}
                  >
                    {t('benchmark.detail.stats.waiting')}
                  </span>
                  <span style={{ color: cssVar.colorTextQuaternary, fontSize: cssVar.fontSizeSM }}>
                    {t('benchmark.detail.stats.noEvalRecord')}
                  </span>
                </Flexbox>
              )}

              {hasCompletedRuns && topAgents.length > 0 && (
                <Flexbox gap={6}>
                  {topAgents.map((agent, idx) => (
                    <Flexbox horizontal align="center" justify="space-between" key={agent.name}>
                      <Flexbox horizontal align="center" gap={8}>
                        <span
                          style={{
                            color: RANK_COLORS[idx] || RANK_COLORS[2],
                            fontFamily: cssVar.fontFamilyCode,
                            fontSize: cssVar.fontSizeSM,
                            fontWeight: 600,
                            minWidth: 14,
                            textAlign: 'center',
                          }}
                        >
                          {idx + 1}
                        </span>
                        <span
                          style={{
                            color: cssVar.colorText,
                            fontSize: cssVar.fontSize,
                            fontWeight: 500,
                          }}
                        >
                          {agent.name}
                        </span>
                      </Flexbox>
                      <span
                        style={{
                          color: cssVar.colorTextSecondary,
                          fontFamily: cssVar.fontFamilyCode,
                          fontSize: cssVar.fontSize,
                        }}
                      >
                        {(agent.avgPassRate * 100).toFixed(1)}%
                      </span>
                    </Flexbox>
                  ))}
                </Flexbox>
              )}
            </Flexbox>
          </div>

          {/* Card 2: Data Scale */}
          <div className={styles.statCard}>
            <Flexbox gap={12}>
              <Flexbox horizontal align="center" gap={8}>
                <div className={styles.statIcon} style={{ background: cssVar.colorPrimaryBg }}>
                  <Layers size={16} style={{ color: cssVar.colorPrimary }} />
                </div>
                <span className={styles.statLabel}>{t('benchmark.detail.stats.dataScale')}</span>
                {totalCases === 0 && (
                  <span
                    style={{
                      backgroundColor: cssVar.colorWarningBg,
                      borderRadius: cssVar.borderRadiusXS,
                      color: cssVar.colorWarning,
                      fontSize: cssVar.fontSizeSM,
                      paddingBlock: 2,
                      paddingInline: 8,
                    }}
                  >
                    {t('benchmark.detail.stats.needSetup')}
                  </span>
                )}
              </Flexbox>

              <Flexbox gap={2}>
                <Flexbox horizontal align="baseline" gap={4}>
                  <span
                    style={{
                      color: cssVar.colorText,
                      fontFamily: cssVar.fontFamilyCode,
                      fontSize: cssVar.fontSizeHeading3,
                      fontWeight: 600,
                    }}
                  >
                    {totalCases}
                  </span>
                  {totalCases > 0 && (
                    <span style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSize }}>
                      Cases
                    </span>
                  )}
                </Flexbox>
                {totalCases === 0 ? (
                  <span style={{ color: cssVar.colorPrimary, fontSize: cssVar.fontSizeSM }}>
                    {t('benchmark.detail.stats.addFirstDataset')}
                  </span>
                ) : (
                  <span style={{ color: cssVar.colorTextQuaternary, fontSize: cssVar.fontSizeSM }}>
                    {datasets.length} Datasets
                  </span>
                )}
              </Flexbox>
            </Flexbox>
          </div>

          {/* Card 3: Avg Duration */}
          <div className={styles.statCard}>
            <Flexbox gap={12}>
              <Flexbox horizontal align="center" gap={8}>
                <div className={styles.statIcon} style={{ background: cssVar.colorInfoBg }}>
                  <Clock size={16} style={{ color: cssVar.colorInfo }} />
                </div>
                <span className={styles.statLabel}>{t('benchmark.detail.stats.avgDuration')}</span>
              </Flexbox>

              {avgDuration == null ? (
                <span
                  style={{
                    color: cssVar.colorTextQuaternary,
                    fontSize: cssVar.fontSizeXL,
                    fontWeight: 600,
                  }}
                >
                  --
                </span>
              ) : (
                <Flexbox gap={2}>
                  <Flexbox horizontal align="baseline" gap={4}>
                    <span
                      style={{
                        color: cssVar.colorText,
                        fontFamily: cssVar.fontFamilyCode,
                        fontSize: cssVar.fontSizeHeading3,
                        fontWeight: 600,
                      }}
                    >
                      {formatDurationMinutes(avgDuration)}
                    </span>
                    <span style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSize }}>
                      min
                    </span>
                  </Flexbox>
                  {p99Duration != null && (
                    <span
                      style={{ color: cssVar.colorTextQuaternary, fontSize: cssVar.fontSizeSM }}
                    >
                      P99: {formatDuration(p99Duration)}
                    </span>
                  )}
                </Flexbox>
              )}
            </Flexbox>
          </div>

          {/* Card 4: Avg Cost */}
          <div className={styles.statCard}>
            <Flexbox gap={12}>
              <Flexbox horizontal align="center" gap={8}>
                <div className={styles.statIcon} style={{ background: cssVar.colorSuccessBg }}>
                  <CircleDollarSign size={16} style={{ color: cssVar.colorSuccess }} />
                </div>
                <span className={styles.statLabel}>{t('benchmark.detail.stats.avgCost')}</span>
              </Flexbox>

              {avgCost == null ? (
                <span
                  style={{
                    color: cssVar.colorTextQuaternary,
                    fontSize: cssVar.fontSizeXL,
                    fontWeight: 600,
                  }}
                >
                  --
                </span>
              ) : (
                <Flexbox gap={2}>
                  <Flexbox horizontal align="baseline" gap={4}>
                    <span
                      style={{
                        color: cssVar.colorText,
                        fontFamily: cssVar.fontFamilyCode,
                        fontSize: cssVar.fontSizeHeading3,
                        fontWeight: 600,
                      }}
                    >
                      ${formatCost(avgCost)}
                    </span>
                    <span style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSize }}>
                      {t('benchmark.detail.stats.perRun')}
                    </span>
                  </Flexbox>
                  <span style={{ color: cssVar.colorTextQuaternary, fontSize: cssVar.fontSizeSM }}>
                    {t('benchmark.detail.stats.basedOnLastNRuns', {
                      count: completedRuns.length,
                    })}
                  </span>
                </Flexbox>
              )}
            </Flexbox>
          </div>
        </Flexbox>
      </>
    );
  },
);

export default BenchmarkHeader;
