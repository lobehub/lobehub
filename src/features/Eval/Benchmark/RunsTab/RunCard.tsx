import type { AgentEvalRunListItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AlertTriangle, ArrowRight, CheckCircle2, Ellipsis, XCircle } from 'lucide-react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelLabel from '@/features/Eval/components/ModelLabel';
import SegmentBar from '@/features/Eval/SegmentBar';
import StatusBadge from '@/features/Eval/StatusBadge';
import { formatDuration } from '@/features/Eval/utils';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { getRunModel } from './runModel';
import { useRunMenu } from './useRunMenu';

const styles = createStaticStyles(({ css }) => ({
  arrowIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
    transition: transform 0.15s ease;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  card: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition:
      border-color 0.15s ease,
      background 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }

    &:hover .run-card-arrow {
      transform: translateX(2px);
      color: ${cssVar.colorText};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;

      &:hover .run-card-arrow {
        transform: none;
      }
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
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextTertiary};

    transition:
      color 0.15s ease,
      background 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  // Tonal hero band carrying the headline outcome — the first thing the eye lands on.
  hero: css`
    padding: 16px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  heroValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading2};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  metaHighlight: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  name: css`
    overflow: hidden;

    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
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
    height: 8px;
    border-radius: 999px;

    background: ${cssVar.colorFillSecondary};
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
  statError: css`
    color: ${cssVar.colorError};
  `,
  statSuccess: css`
    color: ${cssVar.colorSuccess};
  `,
  statWarning: css`
    color: ${cssVar.colorWarning};
  `,
  unit: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
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

  const menuItems = useRunMenu(run, { onEdit, onRefresh });
  const model = getRunModel(run);

  const metrics = run.metrics;
  const totalCases = metrics?.totalCases ?? 0;
  const passedCases = metrics?.passedCases ?? 0;
  const failedCases = metrics?.failedCases ?? 0;
  const errorCases = metrics?.errorCases ?? 0;
  const completedCases = passedCases + failedCases + errorCases;
  const progress = totalCases > 0 ? (completedCases / totalCases) * 100 : 0;
  const passRate = metrics?.passRate != null ? metrics.passRate * 100 : 0;
  const hasStats = (run.status === 'completed' || run.status === 'running') && completedCases > 0;
  const showProgress = totalCases > 0 && run.status !== 'completed';

  const formatDate = (date?: Date | string) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  };

  const metaParts = [
    run.createdAt && { text: formatDate(run.createdAt) },
    run.datasetName && { text: run.datasetName },
    run.targetAgent?.title && { text: run.targetAgent.title },
    metrics?.duration != null && {
      className: styles.metaHighlight,
      text: formatDuration(metrics.duration),
    },
    metrics?.totalCost != null && {
      className: styles.metaHighlight,
      text: `$${metrics.totalCost.toFixed(2)}`,
    },
  ].filter((item): item is { className?: string; text: string } => Boolean(item));

  return (
    <WorkspaceLink className={styles.cardLink} to={`/eval/bench/${benchmarkId}/runs/${run.id}`}>
      <Flexbox className={styles.card} gap={16}>
        {/* Identity row */}
        <Flexbox horizontal align="flex-start" gap={12} justify="space-between">
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.name}>{run.name}</span>
              <StatusBadge status={run.status} />
            </Flexbox>
            {model && <ModelLabel model={model.model} provider={model.provider} size={16} />}
            {metaParts.length > 0 && (
              <Flexbox horizontal align="center" className={styles.meta} gap={4} wrap="wrap">
                {metaParts.map((item, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className={styles.separator}>/</span>}
                    <span className={item.className}>{item.text}</span>
                  </Fragment>
                ))}
              </Flexbox>
            )}
          </Flexbox>
          <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
            <DropdownMenu items={menuItems} placement="bottomRight">
              <span
                className={styles.dropdownTrigger}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <Ellipsis size={16} />
              </span>
            </DropdownMenu>
            <Icon className={`${styles.arrowIcon} run-card-arrow`} icon={ArrowRight} size={16} />
          </Flexbox>
        </Flexbox>

        {/* Outcome hero — pass-rate headline + breakdown, or live progress */}
        {showProgress ? (
          <Flexbox className={styles.hero} gap={10}>
            <Flexbox horizontal align="center" justify="space-between">
              <span className={styles.meta}>
                {completedCases}/{totalCases}
              </span>
              <span className={styles.metaHighlight}>{progress.toFixed(0)}%</span>
            </Flexbox>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
          </Flexbox>
        ) : hasStats ? (
          <Flexbox className={styles.hero} gap={12}>
            <Flexbox horizontal align="flex-end" gap={16} justify="space-between">
              <Flexbox gap={4}>
                <Flexbox horizontal align="baseline" gap={6}>
                  <span className={styles.heroValue}>{passRate.toFixed(0)}%</span>
                  <span className={styles.unit}>{t('run.metrics.passRate')}</span>
                </Flexbox>
              </Flexbox>
              <Flexbox horizontal align="center" gap={12}>
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
            </Flexbox>
            <SegmentBar
              segments={[
                { color: cssVar.colorSuccess, value: passedCases },
                { color: cssVar.colorError, value: failedCases },
                { color: cssVar.colorWarning, value: errorCases },
              ]}
            />
          </Flexbox>
        ) : null}
      </Flexbox>
    </WorkspaceLink>
  );
});

export default RunCard;
