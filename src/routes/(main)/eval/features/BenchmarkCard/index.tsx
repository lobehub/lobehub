'use client';

import { Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  Activity,
  ArrowRight,
  Award,
  BarChart3,
  Database,
  FlaskConical,
  Gauge,
  LoaderPinwheel,
  Play,
  Server,
  Target,
  TrendingUp,
  Trophy,
  Upload,
  User,
  Volleyball,
  Zap,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import Sparkline from '../Sparkline';
import StatusBadge from '../StatusBadge';

const SYSTEM_ICONS = [
  LoaderPinwheel,
  Volleyball,
  Server,
  Target,
  Award,
  Trophy,
  Activity,
  BarChart3,
  TrendingUp,
  Gauge,
  Zap,
];

const getSystemIcon = (id: string) => {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return SYSTEM_ICONS[hash % SYSTEM_ICONS.length];
};

const styles = createStaticStyles(({ css }) => ({
  card: css`
    height: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  // Tonal hero band that carries the headline metric — the first thing the eye
  // lands on, separated from the identity row by a subtle fill.
  metricBand: css`
    padding: 16px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  metricValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading2};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  ctaBand: css`
    padding-block: 24px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,
  detailLink: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextTertiary};

    transition:
      color 0.15s ease,
      background 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadius};
  `,
  name: css`
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorText};
    text-decoration: none;

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorPrimary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  statDivider: css`
    width: 1px;
    height: 24px;
    background: ${cssVar.colorBorderSecondary};
  `,
  statValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface BenchmarkCardProps {
  bestScore?: number;
  datasetCount?: number;
  description?: string;
  id: string;
  name: string;
  recentRuns?: any[];
  runCount?: number;
  source?: 'system' | 'user';
  tags?: string[];
  testCaseCount?: number;
}

// One labeled figure in the stat strip (big mono number over a quiet label).
const Stat = memo<{ label: string; value: number | string }>(({ value, label }) => (
  <Flexbox gap={2}>
    <Text className={styles.statValue} fontSize={16}>
      {value}
    </Text>
    <Text color={cssVar.colorTextTertiary} fontSize={12}>
      {label}
    </Text>
  </Flexbox>
));

const BenchmarkCard = memo<BenchmarkCardProps>(
  ({
    id,
    name,
    description,
    testCaseCount,
    recentRuns,
    runCount = 0,
    bestScore,
    source,
    tags,
    datasetCount = 0,
  }) => {
    const { t } = useTranslation('eval');
    const allRunCount = runCount || recentRuns?.length || 0;
    const hasDatasets = datasetCount > 0;
    const systemIcon = useMemo(() => getSystemIcon(id), [id]);
    const isUser = source === 'user';

    // Pass-rate trend: recentRuns arrives newest-first, so reverse a copy to read
    // left→right oldest→newest. Drop runs that never produced a rate.
    const trend = useMemo(() => {
      const rates = (recentRuns ?? [])
        .map((r) => r?.metrics?.passRate)
        .filter((v): v is number => typeof v === 'number');
      return rates.reverse();
    }, [recentRuns]);

    const bestRate = trend.length > 0 ? Math.max(...trend) : undefined;
    const latestRun = recentRuns?.[0];

    return (
      <Flexbox className={styles.card} gap={16} justify={'space-between'} padding={20}>
        <Flexbox gap={16}>
          {/* Identity */}
          <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
              <div
                className={styles.iconBox}
                style={{ background: isUser ? cssVar.colorSuccessBg : cssVar.colorPrimaryBg }}
              >
                <Icon
                  icon={isUser ? User : systemIcon}
                  size={22}
                  style={{ color: isUser ? cssVar.colorSuccess : cssVar.colorPrimary }}
                />
              </div>
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <WorkspaceLink className={styles.name} to={`/eval/bench/${id}`}>
                  {name}
                </WorkspaceLink>
                {description && (
                  <Text color={cssVar.colorTextTertiary} fontSize={12} lineClamp={1}>
                    {description}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
            <WorkspaceLink className={styles.detailLink} to={`/eval/bench/${id}`}>
              <Icon icon={ArrowRight} size={16} />
            </WorkspaceLink>
          </Flexbox>

          {/* Hero metric band — headline pass rate + trend, or a focused CTA */}
          {!hasDatasets ? (
            <Flexbox align={'center'} className={styles.ctaBand} gap={8}>
              <Icon icon={Database} size={24} style={{ color: cssVar.colorTextQuaternary }} />
              <Flexbox align={'center'} gap={2}>
                <Text color={cssVar.colorTextTertiary}>{t('benchmark.card.noDataset')}</Text>
                <Text color={cssVar.colorTextQuaternary} fontSize={12}>
                  {t('benchmark.card.noDatasetHint')}
                </Text>
              </Flexbox>
              <WorkspaceLink style={{ textDecoration: 'none' }} to={`/eval/bench/${id}`}>
                <Button icon={Upload} size={'small'} variant={'filled'}>
                  {t('benchmark.card.importDataset')}
                </Button>
              </WorkspaceLink>
            </Flexbox>
          ) : bestRate !== undefined ? (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.metricBand}
              justify={'space-between'}
            >
              <Flexbox gap={4}>
                <span className={styles.metricValue}>{(bestRate * 100).toFixed(0)}%</span>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text color={cssVar.colorTextTertiary} fontSize={12}>
                    {t('benchmark.card.bestPassRate')}
                  </Text>
                  {latestRun?.status && <StatusBadge status={latestRun.status} />}
                </Flexbox>
              </Flexbox>
              {trend.length > 1 && <Sparkline values={trend} />}
            </Flexbox>
          ) : (
            <Flexbox align={'center'} className={styles.ctaBand} gap={8}>
              <Icon icon={FlaskConical} size={24} style={{ color: cssVar.colorTextQuaternary }} />
              <Flexbox align={'center'} gap={2}>
                <Text color={cssVar.colorTextTertiary}>{t('benchmark.card.empty')}</Text>
                <Text color={cssVar.colorTextQuaternary} fontSize={12}>
                  {t('benchmark.card.emptyHint')}
                </Text>
              </Flexbox>
              <WorkspaceLink style={{ textDecoration: 'none' }} to={`/eval/bench/${id}?tab=runs`}>
                <Button icon={Play} size={'small'} variant={'filled'}>
                  {t('benchmark.card.startFirst')}
                </Button>
              </WorkspaceLink>
            </Flexbox>
          )}
        </Flexbox>

        {/* Stat strip + tags (pinned) */}
        <Flexbox gap={16}>
          <Flexbox horizontal align={'center'} gap={20}>
            <Stat label={t('sidebar.datasets')} value={datasetCount} />
            <span className={styles.statDivider} />
            <Stat label={t('benchmark.card.casesLabel')} value={testCaseCount || 0} />
            <span className={styles.statDivider} />
            <Stat label={t('benchmark.card.evalsLabel')} value={allRunCount} />
            {bestScore !== undefined && (
              <>
                <span className={styles.statDivider} />
                <Stat label={t('benchmark.card.bestScore')} value={bestScore.toFixed(1)} />
              </>
            )}
          </Flexbox>

          {tags && tags.length > 0 && (
            <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap' }}>
              {tags.slice(0, 4).map((tag) => (
                <Tag key={tag} size={'small'}>
                  {tag}
                </Tag>
              ))}
              {tags.length > 4 && <Tag size={'small'}>+{tags.length - 4}</Tag>}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default BenchmarkCard;
