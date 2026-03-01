import type { AgentEvalRunListItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { App, Card, Dropdown, Progress } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Ellipsis,
  Pencil,
  Play,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useEvalStore } from '@/store/eval';

import StatusBadge from '../../../../features/StatusBadge';
import { formatDuration } from '../../../../utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  arrowIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  card: css`
    transition: all 0.2s;

    .ant-card-body {
      padding: 20px;
    }

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  cardLink: css`
    text-decoration: none;
  `,
  dropdownTrigger: css`
    cursor: pointer;

    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  metaHighlight: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  monoText: css`
    font-family: monospace;
  `,
  name: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  passRate: css`
    font-family: monospace;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.2;
    color: ${cssVar.colorText};
  `,
  passRateLabel: css`
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
  `,
  separator: css`
    color: ${cssVar.colorBorder};
  `,
  stat: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 13px;
  `,
  statError: css`
    color: ${cssVar.colorError};
  `,
  statSuccess: css`
    color: ${cssVar.colorSuccess};
  `,
  statWarning: css`
    color: ${cssVar.colorWarning};
  `,
}));

interface RunCardProps {
  benchmarkId: string;
  onEdit?: (run: AgentEvalRunListItem) => void;
  onRefresh?: () => Promise<void>;
  run: AgentEvalRunListItem;
}

const RunCard = memo<RunCardProps>(({ benchmarkId, run, onRefresh, onEdit }) => {
  const { t } = useTranslation('eval');
  const { modal, message } = App.useApp();
  const deleteRun = useEvalStore((s) => s.deleteRun);
  const startRun = useEvalStore((s) => s.startRun);
  const abortRun = useEvalStore((s) => s.abortRun);

  const metrics = run.metrics;
  const totalCases = metrics?.totalCases ?? 0;
  const passedCases = metrics?.passedCases ?? 0;
  const failedCases = metrics?.failedCases ?? 0;
  const errorCases = metrics?.errorCases ?? 0;
  const completedCases = passedCases + failedCases + errorCases;
  const progress = totalCases > 0 ? (completedCases / totalCases) * 100 : 0;
  const passRate = metrics?.passRate != null ? metrics.passRate * 100 : 0;
  const hasStats = (run.status === 'completed' || run.status === 'running') && completedCases > 0;
  const canStart = run.status === 'idle' || run.status === 'failed' || run.status === 'aborted';
  const isActive = run.status === 'running' || run.status === 'pending';

  const formatDate = (date?: Date | string) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  };

  const handleStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    modal.confirm({
      content: t('run.actions.start.confirm'),
      okText: t('run.actions.start'),
      onOk: async () => {
        try {
          await startRun(run.id, run.status !== 'idle');
          await onRefresh?.();
        } catch (error: any) {
          message.error(error?.message || 'Failed to start run');
        }
      },
      title: t('run.actions.start'),
    });
  };

  const handleAbort = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    modal.confirm({
      content: t('run.actions.abort.confirm'),
      okText: t('run.actions.abort'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await abortRun(run.id);
        await onRefresh?.();
      },
      title: t('run.actions.abort'),
    });
  };

  const handleDelete = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    modal.confirm({
      content: t('run.actions.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.delete'),
      onOk: async () => {
        await deleteRun(run.id);
        await onRefresh?.();
      },
      title: t('run.actions.delete'),
    });
  };

  const handleEdit = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    onEdit?.(run);
  };

  const menuItems = [
    ...(canStart
      ? [
          {
            icon: <Play size={14} />,
            key: 'start',
            label: t('run.actions.start'),
            onClick: ({ domEvent }: any) => handleStart(domEvent),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('run.actions.edit'),
      onClick: ({ domEvent }: any) => handleEdit(domEvent),
    },
    ...(isActive
      ? [
          {
            danger: true,
            icon: <Square size={14} />,
            key: 'abort',
            label: t('run.actions.abort'),
            onClick: ({ domEvent }: any) => handleAbort(domEvent),
          },
        ]
      : []),
    { type: 'divider' as const },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('run.actions.delete'),
      onClick: ({ domEvent }: any) => handleDelete(domEvent),
    },
  ];

  return (
    <Link className={styles.cardLink} to={`/eval/bench/${benchmarkId}/runs/${run.id}`}>
      <Card className={styles.card}>
        <Flexbox horizontal align="center" gap={16}>
          {/* Left: Info */}
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.name}>{run.name}</span>
              <StatusBadge status={run.status} />
            </Flexbox>
            <Flexbox horizontal align="center" className={styles.meta} gap={4}>
              {[
                run.createdAt && { text: formatDate(run.createdAt) },
                run.datasetName && { text: run.datasetName },
                run.targetAgent?.title && { text: run.targetAgent.title },
                run.targetAgent?.model && {
                  className: styles.monoText,
                  text: run.targetAgent.model,
                },
                metrics?.duration != null && {
                  className: styles.metaHighlight,
                  text: formatDuration(metrics.duration),
                },
                metrics?.totalCost != null && {
                  className: styles.metaHighlight,
                  text: `$${metrics.totalCost.toFixed(2)}`,
                },
              ]
                .filter((item): item is { className?: string; text: string } => Boolean(item))
                .map((item, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className={styles.separator}>/</span>}
                    <span className={item.className}>{item.text}</span>
                  </Fragment>
                ))}
            </Flexbox>
          </Flexbox>

          {/* Progress (only for incomplete runs) */}
          {totalCases > 0 && run.status !== 'completed' && (
            <Flexbox gap={4} style={{ width: 160 }}>
              <Flexbox horizontal align="center" justify="space-between">
                <span className={styles.meta}>
                  {completedCases}/{totalCases}
                </span>
                <span className={styles.meta}>{progress.toFixed(0)}%</span>
              </Flexbox>
              <Progress percent={progress} showInfo={false} size="small" />
            </Flexbox>
          )}

          {/* Pass / Fail / Error counts */}
          {hasStats && (
            <Flexbox horizontal align="center" gap={10}>
              <span className={`${styles.stat} ${styles.statSuccess}`}>
                <Icon icon={CheckCircle2} size={14} />
                {passedCases}
              </span>
              <span className={`${styles.stat} ${styles.statError}`}>
                <Icon icon={XCircle} size={14} />
                {failedCases}
              </span>
              {errorCases > 0 && (
                <span className={`${styles.stat} ${styles.statWarning}`}>
                  <Icon icon={AlertTriangle} size={14} />
                  {errorCases}
                </span>
              )}
            </Flexbox>
          )}

          {/* Pass rate */}
          {hasStats && (
            <Flexbox align="flex-end" gap={0} style={{ minWidth: 56 }}>
              <span className={styles.passRate}>{passRate.toFixed(0)}%</span>
              <span className={styles.passRateLabel}>pass rate</span>
            </Flexbox>
          )}

          {/* Actions dropdown */}
          <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
            <span
              className={styles.dropdownTrigger}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <Ellipsis size={16} />
            </span>
          </Dropdown>

          <Icon className={styles.arrowIcon} icon={ArrowRight} size={16} />
        </Flexbox>
      </Card>
    </Link>
  );
});

export default RunCard;
