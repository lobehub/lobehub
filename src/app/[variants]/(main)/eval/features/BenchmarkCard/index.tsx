'use client';

import { Button, Flexbox, Icon, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
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
import { Link } from 'react-router-dom';

import RunRow from './RunRow';

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

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    height: 100%;
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  detailLink: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    transition: all 200ms ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  emptyBox: css`
    padding-block: 24px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  name: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-decoration: none;

    transition: color 200ms ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  recentLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  viewAll: css`
    font-size: 11px;
    color: ${cssVar.colorPrimary};
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
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
    const displayRuns = recentRuns?.slice(0, 3) || [];
    const hasDatasets = datasetCount > 0;
    const systemIcon = useMemo(() => getSystemIcon(id), [id]);

    return (
      <Flexbox className={styles.card} gap={12} justify="space-between">
        {/* Top: Header + Description + Tags */}
        <Flexbox gap={16}>
          {/* Header */}
          <Flexbox horizontal justify="space-between">
            <Flexbox horizontal align="start" gap={12}>
              <div
                className={styles.iconBox}
                style={{
                  background:
                    source === 'user'
                      ? 'var(--ant-color-success-bg)'
                      : 'var(--ant-color-primary-bg)',
                }}
              >
                <Icon
                  icon={source === 'user' ? User : systemIcon}
                  size={24}
                  style={{
                    color:
                      source === 'user' ? 'var(--ant-color-success)' : 'var(--ant-color-primary)',
                  }}
                />
              </div>
              <Flexbox gap={4}>
                <Link className={styles.name} to={`/eval/bench/${id}`}>
                  {name}
                </Link>
                <Flexbox horizontal align="center" className={styles.meta} gap={4}>
                  <span>{t('benchmark.card.datasetCount', { count: datasetCount })}</span>
                  <span>·</span>
                  <span>{t('benchmark.card.caseCount', { count: testCaseCount || 0 })}</span>
                  <span>·</span>
                  <span>{t('benchmark.card.runCount', { count: allRunCount })}</span>
                  {bestScore !== undefined && (
                    <>
                      <span>·</span>
                      <span>
                        {t('benchmark.card.bestScore')}{' '}
                        <span
                          style={{
                            color: 'var(--ant-color-text)',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                          }}
                        >
                          {bestScore.toFixed(1)}
                        </span>
                      </span>
                    </>
                  )}
                </Flexbox>
              </Flexbox>
            </Flexbox>

            <Link className={styles.detailLink} to={`/eval/bench/${id}`}>
              <Icon icon={ArrowRight} size={16} />
            </Link>
          </Flexbox>

          {/* Description */}
          {description && <p className={styles.description}>{description}</p>}

          {/* Tags */}
          {tags && tags.length > 0 && (
            <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap' }}>
              {tags.slice(0, 4).map((tag) => (
                <Tag key={tag} style={{ fontSize: 10 }}>
                  {tag}
                </Tag>
              ))}
              {tags.length > 4 && <Tag style={{ fontSize: 10 }}>+{tags.length - 4}</Tag>}
            </Flexbox>
          )}
        </Flexbox>

        {/* Bottom (pinned) */}
        {!hasDatasets ? (
          <div className={styles.emptyBox}>
            <Icon
              icon={Database}
              size={24}
              style={{ color: 'var(--ant-color-text-quaternary)', marginBottom: 8 }}
            />
            <p style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 13, margin: '0 0 4px' }}>
              {t('benchmark.card.noDataset')}
            </p>
            <p
              style={{
                color: 'var(--ant-color-text-quaternary)',
                fontSize: 12,
                margin: '0 0 12px',
              }}
            >
              {t('benchmark.card.noDatasetHint')}
            </p>
            <Link style={{ textDecoration: 'none' }} to={`/eval/bench/${id}`}>
              <Button icon={Upload} size="small" variant="filled">
                {t('benchmark.card.importDataset')}
              </Button>
            </Link>
          </div>
        ) : (
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" justify="space-between">
              <span className={styles.recentLabel}>{t('benchmark.card.recentRuns')}</span>
              {allRunCount > 3 && (
                <Link className={styles.viewAll} to={`/eval/bench/${id}`}>
                  {t('benchmark.card.viewAll', { count: allRunCount })}
                </Link>
              )}
            </Flexbox>

            {allRunCount > 0 ? (
              <Flexbox gap={6}>
                {displayRuns.length > 0 ? (
                  displayRuns.map((run: any) => {
                    const metrics = run.metrics;
                    const agentSnapshot = run.config?.agentSnapshot;
                    const passedCases = metrics?.passedCases ?? 0;
                    const failedCases = metrics?.failedCases ?? 0;
                    const errorCases = metrics?.errorCases ?? 0;

                    return (
                      <RunRow
                        agentName={agentSnapshot?.title}
                        benchmarkId={id}
                        completedCases={
                          metrics?.completedCases ?? passedCases + failedCases + errorCases
                        }
                        cost={metrics?.totalCost}
                        createdAt={run.createdAt}
                        errorCount={errorCases}
                        failCount={failedCases}
                        id={run.id}
                        key={run.id}
                        model={agentSnapshot?.model}
                        name={run.name}
                        passCount={passedCases}
                        passRate={metrics?.passRate}
                        score={metrics?.averageScore}
                        status={run.status}
                        totalCases={metrics?.totalCases ?? 0}
                      />
                    );
                  })
                ) : (
                  <p
                    style={{
                      color: 'var(--ant-color-text-tertiary)',
                      fontSize: 12,
                      textAlign: 'center',
                      padding: '12px 0',
                    }}
                  >
                    {t('benchmark.card.noRecentRuns')}
                  </p>
                )}
              </Flexbox>
            ) : (
              <div className={styles.emptyBox}>
                <Icon
                  icon={FlaskConical}
                  size={24}
                  style={{ color: 'var(--ant-color-text-quaternary)', marginBottom: 8 }}
                />
                <p
                  style={{
                    color: 'var(--ant-color-text-tertiary)',
                    fontSize: 13,
                    margin: '0 0 4px',
                  }}
                >
                  {t('benchmark.card.empty')}
                </p>
                <p
                  style={{
                    color: 'var(--ant-color-text-quaternary)',
                    fontSize: 12,
                    margin: '0 0 12px',
                  }}
                >
                  {t('benchmark.card.emptyHint')}
                </p>
                <Link style={{ textDecoration: 'none' }} to={`/eval/bench/${id}?tab=runs`}>
                  <Button icon={Play} size="small" variant="filled">
                    {t('benchmark.card.startFirst')}
                  </Button>
                </Link>
              </div>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default BenchmarkCard;
