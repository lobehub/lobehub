'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import StatusBadge from '../StatusBadge';

const styles = createStaticStyles(({ css, cssVar }) => ({
  meta: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  name: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  passRate: css`
    font-family: monospace;
    font-size: 14px;
    font-weight: 700;
    color: ${cssVar.colorText};
  `,
  row: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    transition: all 200ms ${cssVar.motionEaseOut};

    &:hover {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  separator: css`
    color: ${cssVar.colorBorderSecondary};
  `,
  stat: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;
    font-size: 12px;
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
    const formatDate = (iso?: string) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    };

    const progress = totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0;
    const hasStats =
      (status === 'completed' || status === 'running') && passCount + failCount + errorCount > 0;

    return (
      <Link
        style={{ color: 'inherit', textDecoration: 'none' }}
        to={`/eval/bench/${benchmarkId}/runs/${id}`}
      >
        <Flexbox horizontal align="center" className={styles.row} gap={12}>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.name}>{name || id.slice(0, 8)}</span>
              <StatusBadge status={status} />
            </Flexbox>
            <Flexbox horizontal align="center" className={styles.meta} gap={4}>
              {createdAt && <span>{formatDate(createdAt)}</span>}
              {createdAt && agentName && <span className={styles.separator}>/</span>}
              {agentName && <span>{agentName}</span>}
              {(createdAt || agentName) && model && <span className={styles.separator}>/</span>}
              {model && <span style={{ fontFamily: 'monospace' }}>{model}</span>}
              {cost != null && cost > 0 && (
                <>
                  <span className={styles.separator}>/</span>
                  <span>${cost.toFixed(2)}</span>
                </>
              )}
            </Flexbox>
          </Flexbox>

          {status === 'running' ? (
            <Flexbox align="flex-end" gap={2} style={{ width: 100 }}>
              <Flexbox
                horizontal
                align="center"
                justify="space-between"
                style={{ fontSize: 10, color: 'var(--ant-color-text-tertiary)', width: '100%' }}
              >
                <span>
                  {completedCases}/{totalCases}
                </span>
                <span>{progress}%</span>
              </Flexbox>
              <div
                style={{
                  background: 'var(--ant-color-fill-tertiary)',
                  borderRadius: 2,
                  height: 4,
                  overflow: 'hidden',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    background: 'var(--ant-color-primary)',
                    borderRadius: 2,
                    height: '100%',
                    transition: 'width 300ms ease',
                    width: `${progress}%`,
                  }}
                />
              </div>
            </Flexbox>
          ) : hasStats ? (
            <Flexbox horizontal align="center" gap={10}>
              <span className={styles.stat} style={{ color: 'var(--ant-color-success)' }}>
                <Icon icon={CheckCircle2} size={12} />
                {passCount}
              </span>
              <span className={styles.stat} style={{ color: 'var(--ant-color-error)' }}>
                <Icon icon={XCircle} size={12} />
                {failCount}
              </span>
              {errorCount > 0 && (
                <span className={styles.stat} style={{ color: 'var(--ant-color-warning)' }}>
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
              {completedCases}/{totalCases} before failure
            </span>
          ) : (
            <span className={styles.meta}>Queued</span>
          )}

          <Icon
            icon={ArrowRight}
            size={14}
            style={{ color: 'var(--ant-color-text-tertiary)', flexShrink: 0 }}
          />
        </Flexbox>
      </Link>
    );
  },
);

export default RunRow;
