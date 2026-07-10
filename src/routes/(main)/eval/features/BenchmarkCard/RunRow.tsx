'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import StatusBadge from '../StatusBadge';

const styles = createStaticStyles(({ css }) => ({
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  name: css`
    overflow: hidden;

    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  passRate: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSize};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  progressFill: css`
    height: 100%;
    border-radius: 999px;

    background: ${cssVar.colorPrimary};

    transition: width 0.3s ease;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  progressTrack: css`
    overflow: hidden;

    width: 100%;
    height: 4px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  row: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    transition:
      border-color 0.15s ease,
      background 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  separator: css`
    color: ${cssVar.colorBorderSecondary};
  `,
  stat: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: ${cssVar.fontSizeSM};
  `,
}));

interface RunRowProps {
  agentName?: string;
  benchmarkId: string;
  completedCases?: number;
  cost?: number;
  createdAt?: string;
  errorCount?: number;
  failCount?: number;
  id: string;
  model?: string;
  name?: string;
  passCount?: number;
  passRate?: number;
  score?: number;
  status: string;
  totalCases?: number;
}

const RunRow = memo<RunRowProps>(
  ({
    id,
    name,
    status,
    benchmarkId,
    model,
    agentName,
    createdAt,
    passCount = 0,
    failCount = 0,
    errorCount = 0,
    passRate,
    cost,
    completedCases = 0,
    totalCases = 0,
  }) => {
    const { t } = useTranslation('eval');

    const formatDate = (iso?: string) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    };

    const progress = totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0;
    const hasStats =
      (status === 'completed' || status === 'running') && passCount + failCount + errorCount > 0;

    return (
      <WorkspaceLink
        style={{ color: 'inherit', textDecoration: 'none' }}
        to={`/eval/bench/${benchmarkId}/runs/${id}`}
      >
        <Flexbox horizontal align={'center'} className={styles.row} gap={12}>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <span className={styles.name}>{name || id.slice(0, 8)}</span>
              <StatusBadge status={status} />
            </Flexbox>
            <Flexbox horizontal align={'center'} className={styles.meta} gap={4}>
              {createdAt && <span>{formatDate(createdAt)}</span>}
              {createdAt && agentName && <span className={styles.separator}>/</span>}
              {agentName && <span>{agentName}</span>}
              {(createdAt || agentName) && model && <span className={styles.separator}>/</span>}
              {model && <span className={styles.mono}>{model}</span>}
              {cost != null && cost > 0 && (
                <>
                  <span className={styles.separator}>/</span>
                  <span>${cost.toFixed(2)}</span>
                </>
              )}
            </Flexbox>
          </Flexbox>

          {status === 'running' ? (
            <Flexbox align={'flex-end'} gap={4} style={{ width: 100 }}>
              <Flexbox
                horizontal
                align={'center'}
                justify={'space-between'}
                style={{ width: '100%' }}
              >
                <Text color={cssVar.colorTextTertiary} fontSize={12}>
                  {completedCases}/{totalCases}
                </Text>
                <Text color={cssVar.colorTextTertiary} fontSize={12}>
                  {progress}%
                </Text>
              </Flexbox>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
            </Flexbox>
          ) : hasStats ? (
            <Flexbox horizontal align={'center'} gap={12}>
              <span className={styles.stat} style={{ color: cssVar.colorSuccess }}>
                <Icon icon={CheckCircle2} size={12} />
                {passCount}
              </span>
              <span className={styles.stat} style={{ color: cssVar.colorError }}>
                <Icon icon={XCircle} size={12} />
                {failCount}
              </span>
              {errorCount > 0 && (
                <span className={styles.stat} style={{ color: cssVar.colorWarning }}>
                  <Icon icon={AlertTriangle} size={12} />
                  {errorCount}
                </span>
              )}
              {passRate != null && (
                <span className={styles.passRate}>{(passRate * 100).toFixed(0)}%</span>
              )}
            </Flexbox>
          ) : status === 'failed' ? (
            <span className={styles.meta}>
              {t('benchmark.card.run.beforeFailure', { completed: completedCases, total: totalCases })}
            </span>
          ) : (
            <span className={styles.meta}>{t('benchmark.card.run.queued')}</span>
          )}

          <Icon
            icon={ArrowRight}
            size={14}
            style={{ color: cssVar.colorTextTertiary, flexShrink: 0 }}
          />
        </Flexbox>
      </WorkspaceLink>
    );
  },
);

export default RunRow;
